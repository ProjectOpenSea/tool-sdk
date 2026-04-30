import type { PricingEntry } from "../manifest/types.js"
import type { GateMiddleware, ToolContext } from "../../types.js"

export const PAYAI_X402_FACILITATOR_URL =
  "https://facilitator.payai.network"

/**
 * Coinbase Developer Platform x402 facilitator. CDP requires JWT auth signed
 * with your CDP_API_KEY_SECRET. Pass `createAuthHeaders` on `cdpX402Gate` to
 * supply the headers; without them, verify returns 401/403 and the gate
 * surfaces 502.
 */
export const CDP_X402_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402"

export const USDC_BASE_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
export const USDC_BASE_SEPOLIA_ADDRESS =
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e"

const USDC_DECIMALS = 6

const REJECTED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
])

/**
 * Hard timeout for facilitator HTTP calls (both /verify and /settle).
 * Deliberately not coupled to PaymentRequirements.maxTimeoutSeconds: that
 * field is the deadline for the tool's whole response, of which a single
 * facilitator call is only one step. A 10-second cap leaves room for the
 * tool's actual work without letting a slow facilitator hang the request
 * indefinitely.
 */
const FACILITATOR_TIMEOUT_MS = 10_000

const NETWORK_CHAIN_IDS = {
  base: 8453,
  "base-sepolia": 84532,
} as const

const NETWORK_USDC = {
  base: USDC_BASE_ADDRESS,
  "base-sepolia": USDC_BASE_SEPOLIA_ADDRESS,
} as const

export type X402Network = keyof typeof NETWORK_CHAIN_IDS

export interface HostedX402GateConfig {
  recipient: `0x${string}`
  /**
   * USDC amount as a decimal string ("0.01") or already in 6-decimal base
   * units ("10000"). Disambiguated by the presence of a decimal point.
   */
  amountUsdc: string
  network?: X402Network
  description?: string
  maxTimeoutSeconds?: number
  /**
   * Override the resource URL advertised in the 402 response. Defaults to
   * the inbound request URL, which is correct for almost every deployment.
   */
  resource?: string
  /**
   * Override the facilitator URL. Each gate ships a sensible default; supply
   * this only if you are pinning to a specific facilitator instance.
   */
  facilitatorUrl?: string
}

export interface CdpX402GateConfig extends HostedX402GateConfig {
  /**
   * Generate auth headers for CDP /verify calls. CDP requires JWT auth signed
   * with your CDP_API_KEY_SECRET. A built-in helper that wraps
   * `@coinbase/cdp-sdk` is not yet shipped; until it lands, supply your own
   * callback or expect verify to return 401/403.
   */
  createAuthHeaders?: () => Promise<Record<string, string>>
}

interface PaymentRequirementsV1 {
  scheme: "exact"
  network: X402Network
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: Record<string, unknown>
}

interface PaymentPayload {
  x402Version: number
  scheme: string
  network: string
  payload: unknown
}

interface FacilitatorVerifyResponse {
  isValid?: boolean
  invalidReason?: string
  payer?: string
}

interface FacilitatorSettleResponse {
  success?: boolean
  transaction?: string
  network?: string
  payer?: string
  error?: string
  errorReason?: string
}

/**
 * PayAI's hosted x402 facilitator. Free, no API key required. Operated by
 * the PayAI community (https://www.x402.org/ecosystem?filter=facilitators).
 * Use this for prototyping and dogfooding. For production, evaluate CDP
 * (`cdpX402Gate`) once you have CDP credentials.
 */
export function payaiX402Gate(
  config: HostedX402GateConfig,
): GateMiddleware {
  return hostedX402Gate({
    ...config,
    facilitatorUrl: config.facilitatorUrl ?? PAYAI_X402_FACILITATOR_URL,
  })
}

/**
 * Coinbase Developer Platform x402 facilitator. Production-grade and
 * Coinbase-operated, but requires CDP authentication. Supply
 * `createAuthHeaders` to mint a JWT per request; without it the facilitator
 * rejects every verify and the gate surfaces 502.
 */
export function cdpX402Gate(config: CdpX402GateConfig): GateMiddleware {
  return hostedX402Gate({
    ...config,
    facilitatorUrl: config.facilitatorUrl ?? CDP_X402_FACILITATOR_URL,
  })
}

/**
 * Build the manifest `pricing` array advertising USDC-on-Base payment via
 * x402. Identical regardless of which facilitator you choose at runtime, so
 * the advertised price and the enforced wire price stay in lockstep.
 */
export function x402UsdcPricing(
  config: Pick<HostedX402GateConfig, "recipient" | "amountUsdc" | "network">,
): PricingEntry[] {
  validateConfig(config)
  const network = config.network ?? "base"
  const chainId = NETWORK_CHAIN_IDS[network]
  const asset = NETWORK_USDC[network]
  return [
    {
      amount: toBaseUnits(config.amountUsdc, USDC_DECIMALS),
      asset: `eip155:${chainId}/erc20:${asset}`,
      recipient: `eip155:${chainId}:${config.recipient}`,
      protocol: "x402",
    },
  ]
}

function hostedX402Gate(
  config: HostedX402GateConfig & {
    createAuthHeaders?: () => Promise<Record<string, string>>
  },
): GateMiddleware {
  validateConfig(config)
  const network = config.network ?? "base"
  const asset = NETWORK_USDC[network]
  const facilitatorUrl =
    config.facilitatorUrl ?? PAYAI_X402_FACILITATOR_URL
  const maxAmountRequired = toBaseUnits(config.amountUsdc, USDC_DECIMALS)
  const description = config.description ?? "Tool invocation"
  const maxTimeoutSeconds = config.maxTimeoutSeconds ?? 60

  // Per-gate-instance hand-off from check() to settle(). Closure-scoped and
  // keyed by the per-request context, so the user handler (which sees ctx
  // but cannot reach this Map) cannot tamper with the verified payload that
  // settle() will replay to the facilitator. Defense in depth against an
  // operator-authored handler that mutates ctx and silently breaks
  // settlement.
  const stashedByCtx = new WeakMap<
    Partial<ToolContext>,
    { paymentPayload: PaymentPayload; requirements: PaymentRequirementsV1 }
  >()

  return {
    async check(
      request: Request,
      ctx: Partial<ToolContext>,
    ): Promise<Response | null> {
      const resource = config.resource ?? canonicalResource(request.url)
      const requirements: PaymentRequirementsV1 = {
        scheme: "exact",
        network,
        maxAmountRequired,
        resource,
        description,
        mimeType: "application/json",
        payTo: config.recipient,
        maxTimeoutSeconds,
        asset,
        extra: { name: "USD Coin", version: "2" },
      }

      const paymentHeader = request.headers.get("X-Payment")

      if (!paymentHeader) {
        return Response.json(
          {
            x402Version: 1,
            error: "X-PAYMENT header is required",
            accepts: [requirements],
          },
          {
            status: 402,
            headers: { "X-Accept-Payment": "x402" },
          },
        )
      }

      let paymentPayload: PaymentPayload
      try {
        paymentPayload = JSON.parse(safeBase64Decode(paymentHeader))
      } catch {
        return Response.json(
          {
            x402Version: 1,
            error: "invalid_payload",
            accepts: [requirements],
          },
          { status: 402 },
        )
      }

      let authHeaders: Record<string, string> = {}
      if (config.createAuthHeaders) {
        try {
          authHeaders = await config.createAuthHeaders()
        } catch {
          return Response.json(
            { error: "Payment facilitator unreachable" },
            { status: 502 },
          )
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        FACILITATOR_TIMEOUT_MS,
      )

      let res: Response
      try {
        res = await fetch(`${facilitatorUrl}/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 1,
            paymentPayload,
            paymentRequirements: requirements,
          }),
          signal: controller.signal,
        })
      } catch {
        return Response.json(
          { error: "Payment facilitator unreachable" },
          { status: 502 },
        )
      } finally {
        clearTimeout(timeoutId)
      }

      if (!res.ok) {
        return Response.json(
          { error: "Payment facilitator unreachable" },
          { status: 502 },
        )
      }

      const data = (await res.json()) as FacilitatorVerifyResponse

      if (!data.isValid) {
        return Response.json(
          {
            x402Version: 1,
            error: data.invalidReason ?? "invalid_payment",
            accepts: [requirements],
          },
          { status: 402 },
        )
      }

      if (ctx.gates) {
        ctx.gates.x402 = { paid: true }
      }
      stashedByCtx.set(ctx, { paymentPayload, requirements })
      return null
    },
    async settle(ctx: ToolContext): Promise<void> {
      const stashed = stashedByCtx.get(ctx)
      if (!stashed) {
        // Nothing to settle: check() did not run for this ctx (gate
        // short-circuited or was never invoked). Out-of-WeakMap reads
        // mean a handler cannot trick settle into running by mutating
        // ctx — the only path is a successful verify in check().
        return
      }

      // Asymmetric with check() by design: there, a createAuthHeaders
      // throw is caught and surfaced as a 502 to the caller. Here, the
      // throw propagates up to createToolHandler's settle catch and
      // surfaces as a "[tool-sdk] gate.settle failed:" log. The response
      // (already a successful 200) is unchanged either way.
      let authHeaders: Record<string, string> = {}
      if (config.createAuthHeaders) {
        authHeaders = await config.createAuthHeaders()
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        FACILITATOR_TIMEOUT_MS,
      )

      try {
        const res = await fetch(`${facilitatorUrl}/settle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            x402Version: stashed.paymentPayload.x402Version ?? 1,
            paymentPayload: stashed.paymentPayload,
            paymentRequirements: stashed.requirements,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          // Truncate the upstream body so a verbose facilitator error
          // (potentially echoing wallet addresses, nonces, or internal
          // state) does not flood operator log aggregation.
          const body = (await res.text().catch(() => "<no body>")).slice(
            0,
            256,
          )
          throw new Error(
            `facilitator /settle returned ${res.status}: ${body}`,
          )
        }
        const body = (await res.json()) as FacilitatorSettleResponse
        if (!body.success) {
          throw new Error(
            `facilitator /settle reported failure: ${
              body.error ?? body.errorReason ?? "<unknown>"
            }`,
          )
        }
        if (ctx.gates?.x402 && body.transaction) {
          ctx.gates.x402.settlementTxHash = body.transaction
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

export interface ToolPaywallConfig {
  recipient: `0x${string}`
  amountUsdc: string
  network?: X402Network
  facilitator?: "payai" | "cdp"
  /** Required when facilitator is "cdp" */
  createAuthHeaders?: () => Promise<Record<string, string>>
  description?: string
  maxTimeoutSeconds?: number
  resource?: string
  facilitatorUrl?: string
}

export function defineToolPaywall(config: ToolPaywallConfig): {
  pricing: PricingEntry[]
  gate: GateMiddleware
} {
  const pricing = x402UsdcPricing({
    recipient: config.recipient,
    amountUsdc: config.amountUsdc,
    network: config.network,
  })

  const gateConfig: HostedX402GateConfig = {
    recipient: config.recipient,
    amountUsdc: config.amountUsdc,
    network: config.network,
    description: config.description,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    resource: config.resource,
    facilitatorUrl: config.facilitatorUrl,
  }

  if (config.facilitator === "cdp" && !config.createAuthHeaders) {
    throw new Error(
      "defineToolPaywall: createAuthHeaders is required when facilitator is 'cdp'",
    )
  }

  const gate =
    config.facilitator === "cdp"
      ? cdpX402Gate({
          ...gateConfig,
          createAuthHeaders: config.createAuthHeaders,
        })
      : payaiX402Gate(gateConfig)

  return { pricing, gate }
}

function validateConfig(
  config: Pick<HostedX402GateConfig, "recipient" | "amountUsdc">,
): void {
  if (!config.recipient) {
    throw new Error("x402 gate: recipient is required")
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.recipient)) {
    throw new Error(
      `x402 gate: invalid recipient address: ${config.recipient}`,
    )
  }
  if (REJECTED_ADDRESSES.has(config.recipient.toLowerCase())) {
    throw new Error(
      `x402 gate: recipient ${config.recipient} is a burn address — payments sent here are irrecoverable. Set RECIPIENT_ADDRESS to your own wallet.`,
    )
  }
  if (!config.amountUsdc) {
    throw new Error("x402 gate: amountUsdc is required")
  }
  if (/^0+(\.0+)?$/.test(config.amountUsdc)) {
    throw new Error(
      `x402 gate: amountUsdc must be greater than 0 (got "${config.amountUsdc}"); a paywall priced at zero is a misconfiguration`,
    )
  }
}

function toBaseUnits(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`x402 gate: invalid amountUsdc: ${amount}`)
  }
  if (!amount.includes(".")) {
    return amount
  }
  const [whole, frac = ""] = amount.split(".")
  if (frac.length > decimals) {
    throw new Error(
      `x402 gate: amountUsdc has more than ${decimals} decimals: ${amount}`,
    )
  }
  const padded = frac.padEnd(decimals, "0")
  const result = `${whole}${padded}`.replace(/^0+/, "")
  return result === "" ? "0" : result
}

function safeBase64Decode(data: string): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.atob === "function"
  ) {
    return globalThis.atob(data)
  }
  return Buffer.from(data, "base64").toString("utf-8")
}

function canonicalResource(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ""
  return parsed.toString()
}
