import type { WalletAdapter } from "@opensea/wallet-adapters"
import { x402Client, x402HTTPClient } from "@x402/core/client"
import type { Account } from "viem"
import { keccak256, stringToHex } from "viem"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"
import type { CallerUsageReporterConfig } from "../usage/caller-reporter.js"
import { reportCallerX402Usage } from "../usage/caller-reporter.js"
import {
  parseBaseUnitAmount,
  parseX402Challenge,
  type RawRequirements,
  resolveNetwork,
} from "./x402-challenge.js"
import {
  type Eip3009SigningOptions,
  ExactEip3009Scheme,
  signEip3009Authorization,
  toX402PaymentRequired,
  UptoEip3009Scheme,
} from "./x402-scheme.js"

const REJECTED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
])

/**
 * Thrown when a signed x402 payment was sent but the server responded with a
 * 5xx error (e.g. 502 Bad Gateway, 504 Gateway Timeout). The caller should
 * **not** blindly retry: the payment authorization may have already been
 * settled onchain even though the HTTP response indicates failure.
 *
 * Inspect {@link settled} to determine whether settlement headers were
 * present on the response. When `true`, the facilitator confirmed onchain
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
 * swallow the failure: retrying could result in a double charge.
 */
export function rejectServerErrorAfterPayment(res: Response): void {
  if (res.status < 500) return

  const settlement = X402_SETTLEMENT_HEADERS.map(h => res.headers.get(h)).find(
    v => v != null,
  )
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
  extra?: {
    name?: string
    version?: string
    [key: string]: unknown
  }
}

/**
 * Sign an EIP-3009 `TransferWithAuthorization` for a USDC x402 payment.
 * Returns a base64-encoded JSON payment payload. Encode it into
 * `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1).
 *
 * The payload envelope differs by version:
 *  - v1: `{ x402Version, scheme, network, payload }`
 *  - v2: `{ x402Version, payload, resource, accepted }`, where `accepted`
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

  const { signature, authorization } = await signEip3009Authorization(signer, {
    network: reqs.network,
    payTo: reqs.payTo,
    asset: reqs.asset,
    maxAmountRequired: reqs.maxAmountRequired,
    extra: reqs.extra as Record<string, unknown> | undefined,
  })

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

  // In v1, emit the canonical short network name (`base`, `base-sepolia`)
  // rather than echoing back whatever form the challenge advertised (e.g. the
  // CAIP-2 `eip155:8453`). v1 gates historically key off the short name, so a
  // verbatim CAIP-2 echo can be rejected as an "unsupported network".
  const paymentPayload = {
    x402Version,
    scheme: reqs.scheme,
    network: resolveNetwork(reqs.network)?.canonical ?? reqs.network,
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
   * identified by its endpoint URL; no onchain registry coordinates are needed.
   */
  reportCallerUsage?: CallerUsageReporterConfig | boolean
  /**
   * Makes retries of one logical purchase safe. The payment is signed with
   * a nonce derived from this key ({@link idempotencyNonce}), and the token
   * settles a given nonce at most once per payer, so calling `paidFetch`
   * again with the same key after a lost response or a crash cannot charge
   * twice: a second settlement is rejected onchain. A nonce is spent per
   * token contract on each chain, so a key requires `allowedAssets` to be
   * exactly one USDC contract, and the challenge must be for that USDC's own
   * network: every attempt then pays the same token on the same chain. Use one key per
   * logical purchase, such as a UUID stored with the request; reusing a key
   * for a different purchase makes that purchase fail to settle. Applies
   * only to nonzero payments. To let a seller that dedups return the first
   * result, also send your own `Idempotency-Key` header.
   */
  idempotencyKey?: string
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
  const {
    signer,
    maxAmount,
    allowedRecipients,
    allowedAssets,
    reportCallerUsage,
    idempotencyKey,
    ...fetchOptions
  } = options

  if (fetchOptions.body instanceof ReadableStream) {
    throw new Error(
      "paidFetch does not support ReadableStream bodies — pass a string or ArrayBuffer instead",
    )
  }
  assertIdempotencyKeyPinned(idempotencyKey, allowedAssets)

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

  const client = createX402Client(
    signer,
    requirements.network,
    x402Version,
    idempotentSigningOptions(idempotencyKey, requirements),
  )
  const httpClient = new x402HTTPClient(client)

  const paymentRequired = toX402PaymentRequired({
    requirements,
    x402Version,
    raw,
    resource,
  })
  const paymentPayload = await client.createPaymentPayload(paymentRequired)
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload)

  const paidRes = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
      ...paymentHeaders,
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
export function extractSettlementTxHash(res: Response): string | undefined {
  const raw = X402_SETTLEMENT_HEADERS.map(h => res.headers.get(h)).find(
    v => v != null,
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
 * version (v2 uses `PAYMENT-RESPONSE`, v1 used `X-PAYMENT-RESPONSE`), matching
 * the request header named by {@link x402PaymentHeaderName}.
 */
export function buildSettlementResponseHeader(params: {
  x402Version: number
  transaction: string
  network?: string
  payer?: string
}): { name: string; value: string } {
  const name =
    params.x402Version >= 2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE"
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
    const allowed = new Set(opts.allowedRecipients.map(a => a.toLowerCase()))
    if (!allowed.has(payToLower)) {
      throw new Error(
        `x402: payTo address ${reqs.payTo} is not in allowedRecipients`,
      )
    }
  }

  // Parse as an unsigned integer first: a negative or malformed amount must
  // never reach the signed cap comparison (a negative value would slip under
  // a positive cap) or the EIP-3009 signer (where it would wrap into a huge
  // positive uint256). Validate unconditionally, even when no cap is set.
  const requested = parseBaseUnitAmount(
    reqs.maxAmountRequired,
    "maxAmountRequired",
  )
  if (opts.maxAmount !== undefined) {
    const cap = parseBaseUnitAmount(opts.maxAmount, "maxAmount")
    if (requested > cap) {
      throw new Error(
        `x402: server requested ${reqs.maxAmountRequired} but maxAmount is ${opts.maxAmount}`,
      )
    }
  }

  const assetLower = reqs.asset.toLowerCase()
  if (opts.allowedAssets) {
    const allowed = new Set(opts.allowedAssets.map(a => a.toLowerCase()))
    if (!allowed.has(assetLower)) {
      throw new Error(`x402: asset ${reqs.asset} is not in allowedAssets`)
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

/**
 * The EIP-3009 nonce `paidFetch` and `paidAuthenticatedFetch` sign for an
 * `idempotencyKey`: keccak256 of a namespaced form of the key. The same key
 * always yields the same nonce, so the token settles it at most once per
 * payer.
 */
export function idempotencyNonce(idempotencyKey: string): `0x${string}` {
  if (idempotencyKey.length === 0) {
    throw new Error("idempotencyKey must be a non-empty string")
  }
  return keccak256(
    stringToHex(`opensea-tool-sdk/x402/idempotency:${idempotencyKey}`),
  )
}

const KNOWN_USDC = new Set(
  [USDC_BASE_ADDRESS, USDC_BASE_SEPOLIA_ADDRESS].map(a => a.toLowerCase()),
)

/**
 * EIP-3009 tracks nonces per token contract on each chain, so the same
 * idempotency nonce in any other (chain, token) domain is fresh and would
 * settle again. A key therefore requires `allowedAssets` to be exactly one
 * USDC contract; {@link idempotentSigningOptions} then requires the challenge
 * to be for that contract's own network, leaving one possible domain.
 */
export function assertIdempotencyKeyPinned(
  idempotencyKey: string | undefined,
  allowedAssets: string[] | undefined,
): void {
  if (idempotencyKey === undefined) return
  idempotencyNonce(idempotencyKey)
  if (
    allowedAssets?.length !== 1 ||
    !KNOWN_USDC.has(allowedAssets[0].toLowerCase())
  ) {
    throw new Error(
      "idempotencyKey requires allowedAssets with exactly one USDC contract (USDC_BASE_ADDRESS or USDC_BASE_SEPOLIA_ADDRESS), so every retry pays the same token on the same chain",
    )
  }
}

/**
 * Signing options for one challenge: the idempotency nonce for a nonzero
 * payment when a key is set, otherwise a random nonce. A zero-value
 * authorization (the predicate gate's) keeps a random nonce so it can never
 * consume the nonce the real payment needs. A keyed payment must be for the
 * USDC of the challenge's own network, so the pinned asset also pins the
 * chain.
 */
export function idempotentSigningOptions(
  idempotencyKey: string | undefined,
  requirements: Pick<
    PaymentRequirements,
    "network" | "asset" | "maxAmountRequired"
  >,
): Eip3009SigningOptions {
  if (idempotencyKey === undefined) {
    return {}
  }
  const nonce = idempotencyNonce(idempotencyKey)
  if (BigInt(requirements.maxAmountRequired) === 0n) {
    return {}
  }
  const usdc = resolveNetwork(requirements.network)?.usdc
  if (usdc?.toLowerCase() !== requirements.asset.toLowerCase()) {
    throw new Error(
      `idempotencyKey covers USDC on the challenged network only: the 402 asks for ${requirements.asset} on ${requirements.network}`,
    )
  }
  return { nonce }
}

/**
 * Create an x402Client with both exact and upto EIP-3009 schemes registered
 * for the specified network and protocol version. The x402Client routes to
 * the correct scheme based on the challenge's `scheme` field.
 */
export function createX402Client(
  signer: WalletAdapter | Account,
  network: string,
  x402Version: number,
  signingOptions: Eip3009SigningOptions = {},
): x402Client {
  const exact = new ExactEip3009Scheme(signer, signingOptions)
  const upto = new UptoEip3009Scheme(signer, signingOptions)
  const client = new x402Client()
  if (x402Version >= 2) {
    client.register(network as `${string}:${string}`, exact)
    client.register(network as `${string}:${string}`, upto)
  } else {
    client.registerV1(network, exact)
    client.registerV1(network, upto)
  }
  return client
}
