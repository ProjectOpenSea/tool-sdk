import type { WalletAdapter } from "@opensea/wallet-adapters"
import type { Account } from "viem"
import { toHex } from "viem"
import type { CallerUsageReporterConfig } from "../usage/caller-reporter.js"
import { reportCallerX402Usage } from "../usage/caller-reporter.js"
import {
  parseX402Challenge,
  type RawRequirements,
  resolveNetwork,
} from "./x402-challenge.js"

const REJECTED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
])

/**
 * Thrown when a signed x402 payment was sent but the server responded with a
 * 5xx error (e.g. 502 Bad Gateway, 504 Gateway Timeout). The caller should
 * **not** blindly retry — the payment authorization may have already been
 * settled on-chain even though the HTTP response indicates failure.
 *
 * Inspect {@link settled} to determine whether settlement headers were
 * present on the response. When `true`, the facilitator confirmed on-chain
 * settlement before the transport error occurred; when `false`, settlement
 * likely did not happen but is not guaranteed (a reverse proxy may have
 * dropped the response after the server settled).
 */
export class X402PaymentError extends Error {
  readonly response: Response
  readonly settled: boolean

  constructor(message: string, response: Response, settled: boolean) {
    super(message)
    this.name = "X402PaymentError"
    this.response = response
    this.settled = settled
  }
}

/**
 * Throw if a paid response came back with a server error (5xx). The signed
 * authorization was already transmitted, so the caller must not silently
 * swallow the failure — retrying could result in a double charge.
 */
export function rejectServerErrorAfterPayment(res: Response): void {
  if (res.status < 500) return

  const settlement = X402_SETTLEMENT_HEADERS.map((h) =>
    res.headers.get(h),
  ).find((v) => v != null)
  const settled = settlement != null

  throw new X402PaymentError(
    `x402: payment was signed and sent but the server returned ${res.status}` +
      (settled
        ? " — settlement headers present, payment may have been charged"
        : " — no settlement headers, payment was likely not settled"),
    res,
    settled,
  )
}

/**
 * The HTTP header that carries the signed payment for a given x402 version.
 * v2 uses `PAYMENT-SIGNATURE`; v1 uses `X-PAYMENT`. Sending the wrong header
 * makes a v2 server silently ignore the payment and re-issue its 402.
 */
export function x402PaymentHeaderName(x402Version: number): string {
  return x402Version >= 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT"
}

/**
 * The settlement-response headers a server may return, in priority order.
 * v2 uses `PAYMENT-RESPONSE`; v1 used `X-PAYMENT-RESPONSE`.
 */
export const X402_SETTLEMENT_HEADERS = [
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
] as const

export interface PaymentRequirements {
  scheme: string
  /**
   * Network identifier. Accepts both the short names this SDK's middleware
   * emits (`base`, `base-sepolia`) and the CAIP-2 forms the broader x402
   * ecosystem uses (`eip155:8453`). Resolved via {@link resolveNetwork}.
   */
  network: string
  maxAmountRequired: string
  payTo: string
  asset: string
  extra?: { name?: string; version?: string }
}

/**
 * Sign an EIP-3009 `TransferWithAuthorization` for a USDC x402 payment.
 * Returns a base64-encoded JSON payment payload. Encode it into the header
 * named by {@link x402PaymentHeaderName} for the matching version.
 *
 * The payload envelope differs by version:
 *  - **v1** — `{ x402Version, scheme, network, payload }`
 *  - **v2** — `{ x402Version, payload, resource, accepted }`, where `accepted`
 *    echoes the server's `accepts[0]` verbatim. Pass `accepted`/`resource`
 *    from the parsed challenge so the facilitator can match the payment.
 */
export async function signX402Payment(params: {
  signer: WalletAdapter | Account
  paymentRequirements: PaymentRequirements
  /**
   * x402 protocol version to echo in the payment payload. Defaults to 1.
   * Pass the version advertised in the server's 402 challenge so the payload
   * matches what the facilitator expects.
   */
  x402Version?: number
  /**
   * The server's verbatim `accepts[0]` requirement, echoed in the v2 payload's
   * `accepted` field. Defaults to a requirement reconstructed from
   * `paymentRequirements` (v2 only).
   */
  accepted?: RawRequirements
  /** The server's `resource` descriptor, echoed in the v2 payload. */
  resource?: unknown
}): Promise<string> {
  const { signer, paymentRequirements: reqs } = params

  const resolved = resolveNetwork(reqs.network)
  if (resolved === undefined) {
    throw new Error(`Unsupported network: ${reqs.network}`)
  }
  const { chainId } = resolved

  const isAdapter = "capabilities" in signer
  const address = isAdapter
    ? await (signer as WalletAdapter).getAddress()
    : (signer as Account).address

  const nonceBytes = new Uint8Array(32)
  crypto.getRandomValues(nonceBytes)
  const nonce = toHex(nonceBytes)

  const validAfter = "0"
  const validBefore = String(Math.floor(Date.now() / 1000) + 600)

  const authorization = {
    from: address as `0x${string}`,
    to: reqs.payTo as `0x${string}`,
    value: reqs.maxAmountRequired,
    validAfter,
    validBefore,
    nonce,
  } as const

  const domain = {
    name: reqs.extra?.name ?? "USD Coin",
    version: reqs.extra?.version ?? "2",
    chainId,
    verifyingContract: reqs.asset as `0x${string}`,
  }
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  }

  let signature: string
  if (isAdapter) {
    const adapter = signer as WalletAdapter
    if (!adapter.capabilities.signTypedData || !adapter.signTypedData) {
      throw new Error(
        `Wallet provider "${adapter.name}" does not support signTypedData`,
      )
    }
    signature = await adapter.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
    })
  } else {
    const account = signer as Account
    if (!account.signTypedData) {
      throw new Error(
        "account.signTypedData is required — use a Local Account (e.g. privateKeyToAccount)",
      )
    }
    signature = await account.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization" as const,
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    })
  }

  const x402Version = params.x402Version ?? 1
  const payload = { signature, authorization }

  if (x402Version >= 2) {
    const accepted: RawRequirements = params.accepted ?? {
      scheme: reqs.scheme,
      network: reqs.network,
      amount: reqs.maxAmountRequired,
      payTo: reqs.payTo,
      asset: reqs.asset,
      extra: reqs.extra,
    }
    return btoa(
      JSON.stringify({
        x402Version,
        payload,
        resource: params.resource,
        accepted,
      }),
    )
  }

  const paymentPayload = {
    x402Version,
    scheme: reqs.scheme,
    // Echo the network exactly as advertised (short name or CAIP-2) so the
    // facilitator can match the payment to the challenge it issued.
    network: reqs.network,
    payload,
  }

  return btoa(JSON.stringify(paymentPayload))
}

export interface PaidFetchOptions extends RequestInit {
  signer: WalletAdapter | Account
  /**
   * Maximum amount (in the token's smallest unit) that may be authorized.
   * If the server requests more than this, `paidFetch` throws instead of
   * signing. Omit to accept whatever the server asks for.
   */
  maxAmount?: string
  /**
   * Allowlist of recipient addresses. If provided, `paidFetch` throws when
   * the server's `payTo` is not in this list. Addresses are compared
   * case-insensitively.
   */
  allowedRecipients?: string[]
  /**
   * Allowlist of asset contract addresses. If provided, `paidFetch` throws
   * when the server's `asset` is not in this list. Addresses are compared
   * case-insensitively.
   *
   * When omitted, defaults to the known USDC contract for the requested
   * network (`base` → `USDC_BASE_ADDRESS`, `base-sepolia` →
   * `USDC_BASE_SEPOLIA_ADDRESS`).
   */
  allowedAssets?: string[]
  /**
   * When set, sends a fire-and-forget caller-side usage report to the
   * OpenSea usage endpoint after a successful x402 payment. The tool is
   * identified by its endpoint URL — no onchain registry coordinates needed.
   */
  reportCallerUsage?: CallerUsageReporterConfig | boolean
}

/**
 * Fetch wrapper that handles x402 payment challenges automatically.
 *
 * Makes an initial request; if the server responds with 402 and an x402
 * `accepts` array, signs a payment using the provided `signer` and replays
 * the request with an `X-Payment` header.
 *
 * **Security:** `paidFetch` trusts the server's 402 response to determine
 * the payment recipient, token, and amount. A compromised server can
 * request payment to an attacker-controlled address or for an inflated
 * amount. Use `maxAmount`, `allowedRecipients`, and `allowedAssets` to
 * constrain what gets signed. By default, `asset` is validated against
 * the known USDC contract address for the network, and `payTo` is
 * rejected if it is the zero address or a known burn address.
 *
 * `body` must be a string, `ArrayBuffer`, or other re-readable type.
 * `ReadableStream` bodies are not supported (the body is consumed twice).
 */
export async function paidFetch(
  url: string,
  options: PaidFetchOptions,
): Promise<Response> {
  const { signer, maxAmount, allowedRecipients, allowedAssets, reportCallerUsage, ...fetchOptions } = options

  if (fetchOptions.body instanceof ReadableStream) {
    throw new Error(
      "paidFetch does not support ReadableStream bodies — pass a string or ArrayBuffer instead",
    )
  }

  const probeRes = await fetch(url, fetchOptions)

  if (probeRes.status !== 402) {
    return probeRes
  }

  const parsed = await parseX402Challenge(probeRes)
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  const { requirements, x402Version, raw, resource } = parsed

  validatePaymentRequirements(requirements, {
    maxAmount,
    allowedRecipients,
    allowedAssets,
  })

  const xPayment = await signX402Payment({
    signer,
    paymentRequirements: requirements,
    x402Version,
    accepted: raw,
    resource,
  })

  const paidRes = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
      [x402PaymentHeaderName(x402Version)]: xPayment,
    },
  })

  rejectServerErrorAfterPayment(paidRes)

  if (reportCallerUsage && paidRes.ok) {
    const settlement = extractSettlementTxHash(paidRes)
    const resolved = resolveNetwork(requirements.network)
    if (settlement && resolved) {
      const callerAddress = await resolveSignerAddress(signer)
      const config =
        typeof reportCallerUsage === "object" ? reportCallerUsage : {}
      reportCallerX402Usage(
        {
          toolEndpoint: url,
          callerAddress: callerAddress as `0x${string}`,
          txHash: settlement,
          chainId: resolved.chainId,
        },
        config,
      ).catch(() => {})
    }
  }

  return paidRes
}

/**
 * Extract the onchain settlement tx hash from x402 response headers.
 * Returns `undefined` if no settlement header is present.
 */
export function extractSettlementTxHash(
  res: Response,
): string | undefined {
  const raw = X402_SETTLEMENT_HEADERS.map((h) => res.headers.get(h)).find(
    (v) => v != null,
  )
  if (!raw) return undefined
  try {
    const decoded = JSON.parse(
      typeof atob === "function"
        ? atob(raw)
        : Buffer.from(raw, "base64").toString("utf-8"),
    ) as { transaction?: string }
    return decoded.transaction
  } catch {
    return undefined
  }
}

/**
 * Build the x402 settlement-response header a tool server returns after it
 * settles a payment. The encoding is the inverse of {@link extractSettlementTxHash}:
 * a base64-encoded JSON settle response. The header name tracks the protocol
 * version — v2 uses `PAYMENT-RESPONSE`, v1 used `X-PAYMENT-RESPONSE` — matching
 * the request header named by {@link x402PaymentHeaderName}.
 */
export function buildSettlementResponseHeader(params: {
  x402Version: number
  transaction: string
  network?: string
  payer?: string
}): { name: string; value: string } {
  const name = params.x402Version >= 2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE"
  const json = JSON.stringify({
    success: true,
    transaction: params.transaction,
    network: params.network,
    payer: params.payer,
  })
  const value =
    typeof btoa === "function"
      ? btoa(json)
      : Buffer.from(json, "utf-8").toString("base64")
  return { name, value }
}

async function resolveSignerAddress(
  signer: WalletAdapter | Account,
): Promise<string> {
  if ("capabilities" in signer) {
    return (signer as WalletAdapter).getAddress()
  }
  return (signer as Account).address
}

/**
 * Validate a server's payment requirements before signing: reject burn/zero
 * recipients, enforce optional recipient/asset allowlists, cap the amount via
 * `maxAmount`, and (by default) require the asset to be the known USDC contract
 * for the network. Throws on any violation. Exported so the `pay` CLI applies
 * the same guardrails as `paidFetch`.
 */
export function validatePaymentRequirements(
  reqs: PaymentRequirements,
  opts: {
    maxAmount?: string
    allowedRecipients?: string[]
    allowedAssets?: string[]
  },
): void {
  const payToLower = reqs.payTo.toLowerCase()

  if (REJECTED_ADDRESSES.has(payToLower)) {
    throw new Error(
      `x402: payTo address ${reqs.payTo} is a burn/zero address — refusing to sign`,
    )
  }

  if (opts.allowedRecipients) {
    const allowed = new Set(opts.allowedRecipients.map((a) => a.toLowerCase()))
    if (!allowed.has(payToLower)) {
      throw new Error(
        `x402: payTo address ${reqs.payTo} is not in allowedRecipients`,
      )
    }
  }

  if (opts.maxAmount !== undefined) {
    if (BigInt(reqs.maxAmountRequired) > BigInt(opts.maxAmount)) {
      throw new Error(
        `x402: server requested ${reqs.maxAmountRequired} but maxAmount is ${opts.maxAmount}`,
      )
    }
  }

  const assetLower = reqs.asset.toLowerCase()
  if (opts.allowedAssets) {
    const allowed = new Set(opts.allowedAssets.map((a) => a.toLowerCase()))
    if (!allowed.has(assetLower)) {
      throw new Error(
        `x402: asset ${reqs.asset} is not in allowedAssets`,
      )
    }
  } else {
    const expectedUsdc = resolveNetwork(reqs.network)?.usdc
    if (expectedUsdc && assetLower !== expectedUsdc.toLowerCase()) {
      throw new Error(
        `x402: asset ${reqs.asset} does not match expected USDC address for ${reqs.network} (${expectedUsdc})`,
      )
    }
  }
}
