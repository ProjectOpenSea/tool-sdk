import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
  type X402Network,
} from "../middleware/x402-facilitators.js"
import type { PaymentRequirements } from "./x402-payment.js"

/**
 * Resolve an x402 `network` identifier to its chain id and canonical USDC
 * address. Accepts both the short names emitted by this SDK's own middleware
 * (`base`, `base-sepolia`) and the CAIP-2 / numeric forms emitted by the
 * broader x402 ecosystem (`eip155:8453`, `8453`). Returns `undefined` for
 * unsupported networks so callers can throw a descriptive error.
 */
export function resolveNetwork(
  network: string,
): { chainId: number; usdc: string; canonical: X402Network } | undefined {
  switch (network) {
    case "base":
    case "eip155:8453":
    case "8453":
      return { chainId: 8453, usdc: USDC_BASE_ADDRESS, canonical: "base" }
    case "base-sepolia":
    case "eip155:84532":
    case "84532":
      return {
        chainId: 84532,
        usdc: USDC_BASE_SEPOLIA_ADDRESS,
        canonical: "base-sepolia",
      }
    default:
      return undefined
  }
}

/**
 * Parse an x402 amount (in the token's smallest unit) into a `bigint`,
 * rejecting anything that is not a canonical non-negative integer.
 *
 * x402 amounts are unsigned `uint256` values. A negative or otherwise
 * malformed amount must be rejected before it is compared against a
 * spending cap or encoded into an EIP-3009 authorization: a signed
 * comparison would let a negative value slip under a positive `maxAmount`
 * cap, and the EIP-712 `uint256` encoder wraps a negative value into a huge
 * positive integer via two's complement — producing an authorization far
 * larger than the caller intended.
 *
 * Only plain decimal digit strings are accepted (`"0"`, `"10000"`).
 * Signs, decimals, hex (`0x…`), scientific notation, whitespace, and empty
 * strings all throw.
 */
export function parseBaseUnitAmount(value: string, label = "amount"): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(
      `x402: ${label} "${value}" is not a valid non-negative integer amount (token base units)`,
    )
  }
  return BigInt(value)
}

export type ParsedChallenge =
  | {
      ok: true
      requirements: PaymentRequirements
      x402Version: number
      /**
       * The untouched `accepts[0]` object from the challenge. x402 v2 payment
       * payloads must echo this verbatim in the `accepted` field, so we keep
       * it rather than reconstructing it from the normalized requirements.
       */
      raw: RawRequirements
      /** The `resource` descriptor from a v2 challenge, if present. */
      resource?: unknown
    }
  | { ok: false; reason: string }

export interface RawRequirements {
  scheme?: string
  network?: string
  /** x402 v1 field. */
  maxAmountRequired?: string
  /** x402 v2 field. */
  amount?: string
  payTo?: string
  asset?: string
  extra?: { name?: string; version?: string }
  [key: string]: unknown
}

interface RawChallenge {
  x402Version?: number
  accepts?: RawRequirements[]
  resource?: unknown
}

function normalizeRequirements(raw: RawRequirements): PaymentRequirements {
  return {
    scheme: raw.scheme ?? "exact",
    network: raw.network ?? "base",
    // x402 v2 renamed `maxAmountRequired` to `amount`; accept either.
    maxAmountRequired: raw.maxAmountRequired ?? raw.amount ?? "0",
    payTo: raw.payTo ?? "",
    asset: raw.asset ?? "",
    extra: raw.extra,
  }
}

/**
 * Parse an x402 402 challenge from a response, transparently handling both
 * wire formats:
 *
 *  - **v1** — the challenge JSON (`{ x402Version, accepts: [...] }`) is the
 *    response body.
 *  - **v2** — the challenge is a base64-encoded JSON in the
 *    `PAYMENT-REQUIRED` response header and the body may be empty.
 *
 * Consumes the response body. The caller must have already confirmed the
 * status is 402.
 */
export async function parseX402Challenge(
  res: globalThis.Response,
): Promise<ParsedChallenge> {
  const header =
    res.headers.get("payment-required") ?? res.headers.get("x-payment-required")

  let challenge: RawChallenge
  if (header) {
    try {
      challenge = JSON.parse(
        Buffer.from(header, "base64").toString("utf-8"),
      ) as RawChallenge
    } catch {
      return {
        ok: false,
        reason:
          "x402: server returned 402 but the PAYMENT-REQUIRED header is not valid base64 JSON",
      }
    }
  } else {
    try {
      challenge = (await res.json()) as RawChallenge
    } catch {
      return {
        ok: false,
        reason: "x402: server returned 402 but body is not valid JSON",
      }
    }
  }

  const raw = challenge.accepts?.[0]
  if (!raw) {
    return {
      ok: false,
      reason: "x402: server returned 402 but body.accepts is missing or empty",
    }
  }

  // Fail fast on a malformed challenge rather than signing an authorization
  // with an empty `payTo`/`asset` (which would later fail with a confusing
  // viem error) or a missing amount.
  if (
    !raw.payTo ||
    !raw.asset ||
    (raw.maxAmountRequired == null && raw.amount == null)
  ) {
    return {
      ok: false,
      reason:
        "x402: 402 challenge is missing a payTo, asset, or amount in accepts[0]",
    }
  }

  return {
    ok: true,
    requirements: normalizeRequirements(raw),
    x402Version: challenge.x402Version ?? 1,
    raw,
    resource: challenge.resource,
  }
}
