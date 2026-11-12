import type { Account } from "viem"
import { derivePredicateGateRecipient } from "../predicate-gate-audience.js"
import type {
  SignZeroValueAuthorizationParams,
  ZeroValueAuthorization,
} from "../usage/eip3009-auth.js"
import { resolveNetwork } from "./x402-challenge.js"
import {
  type PaymentRequirements,
  signX402Payment,
  validatePaymentRequirements,
} from "./x402-payment.js"

export type { SignZeroValueAuthorizationParams, ZeroValueAuthorization }

export interface Eip3009AuthenticatedFetchOptions extends RequestInit {
  account: Account
  /** Restrict which `payTo` addresses the client will sign for. */
  allowedRecipients?: string[]
}

/**
 * Encode a `ZeroValueAuthorization` as an `Authorization: EIP-3009 <token>`
 * header value. The payload is base64url-encoded JSON without padding.
 * Predicate gates in this SDK read only `X-Payment`, not this header; use
 * `eip3009AuthenticatedFetch` to call a predicate-gated tool.
 */
export function createEip3009AuthHeader(
  authorization: ZeroValueAuthorization,
): string {
  const json = JSON.stringify(authorization)
  const encoded = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `EIP-3009 ${encoded}`
}

/**
 * Fetch wrapper for predicate-gated tools. Sends the request; on 402,
 * signs an `X-Payment` header (zero-value EIP-3009 `TransferWithAuthorization`)
 * using the advertised `payTo` and retries once. Before signing a zero-value
 * challenge, it verifies that `payTo` binds the final endpoint URL to the
 * advertised tool ID and operator. Same-origin redirects are allowed;
 * cross-origin redirects fail before signing.
 *
 * This is an identity-only flow: the signed authorization always has
 * `value: 0`, so no USDC can move. If the challenge requests a non-zero
 * amount, nothing is signed and the 402 response is returned as-is. Use
 * `paidFetch` or `paidAuthenticatedFetch` for endpoints that require real
 * payment.
 *
 * The challenge's `asset` must be the canonical USDC contract for a
 * supported network. Signing over an arbitrary verifying contract is
 * refused (throws), since a non-USDC contract could assign different
 * semantics to a zero-value `TransferWithAuthorization`.
 */
export async function eip3009AuthenticatedFetch(
  url: string,
  options: Eip3009AuthenticatedFetchOptions,
): Promise<Response> {
  const { account, allowedRecipients, ...fetchOptions } = options

  const baseHeaders = Object.fromEntries(
    new Headers(fetchOptions.headers).entries(),
  )

  const res = await fetch(url, {
    ...fetchOptions,
    headers: baseHeaders,
  })

  if (res.status === 402) {
    const requirements = await extractPaymentRequirements(res)
    if (requirements) {
      if (allowedRecipients) {
        const allowed = new Set(allowedRecipients.map(a => a.toLowerCase()))
        if (!allowed.has(requirements.payTo.toLowerCase())) {
          throw new Error(
            `eip3009: payTo address ${requirements.payTo} is not in allowedRecipients`,
          )
        }
      }
      let isZeroAmount = false
      try {
        isZeroAmount = BigInt(requirements.maxAmountRequired ?? "0") === 0n
      } catch {
        // unparseable amount: treat as non-zero and refuse to sign
      }
      if (!isZeroAmount) {
        // The endpoint is asking for a real payment. This flow only proves
        // identity, so return the 402 untouched rather than signing an
        // authorization that could move USDC.
        return res
      }
      const binding = parsePredicateGateBinding(requirements.extra)
      if (!binding) {
        throw new Error(
          "eip3009: predicate gate challenge is missing a valid audience binding",
        )
      }
      const challengeAudience = resolveChallengeAudience(url, res)
      const expectedRecipient = derivePredicateGateRecipient({
        audience: challengeAudience,
        toolId: binding.toolId,
        operatorAddress: binding.operatorAddress,
      })
      if (
        requirements.payTo.toLowerCase() !== expectedRecipient.toLowerCase()
      ) {
        throw new Error(
          `eip3009: payTo address ${requirements.payTo} is not bound to ${challengeAudience}`,
        )
      }
      if (!resolveNetwork(requirements.network)) {
        throw new Error(
          `x402: network ${requirements.network} is not supported — refusing to sign`,
        )
      }
      // Rejects burn/zero recipients and any `asset` that is not the
      // canonical USDC contract for the network, so the signature can only
      // ever be a zero-value USDC authorization.
      validatePaymentRequirements(
        { ...requirements, maxAmountRequired: "0" },
        { maxAmount: "0" },
      )
      const xPayment = await signX402Payment({
        signer: account,
        paymentRequirements: { ...requirements, maxAmountRequired: "0" },
      })
      return fetch(challengeAudience, {
        ...fetchOptions,
        headers: {
          ...baseHeaders,
          "X-Payment": xPayment,
        },
      })
    }
  }

  return res
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

function parsePredicateGateBinding(extra: PaymentRequirements["extra"]): {
  toolId: bigint
  operatorAddress: `0x${string}`
} | null {
  const raw = extra?.predicateGate
  if (!raw || typeof raw !== "object") return null
  const binding = raw as Record<string, unknown>
  if (
    typeof binding.toolId !== "string" ||
    typeof binding.operatorAddress !== "string" ||
    !EVM_ADDRESS.test(binding.operatorAddress)
  ) {
    return null
  }
  try {
    const toolId = BigInt(binding.toolId)
    if (toolId < 0n) return null
    return {
      toolId,
      operatorAddress: binding.operatorAddress as `0x${string}`,
    }
  } catch {
    return null
  }
}

function resolveChallengeAudience(url: string, res: Response): string {
  const requested =
    typeof globalThis.location === "object"
      ? new URL(url, globalThis.location.href)
      : new URL(url)
  const response = res.url ? new URL(res.url) : requested
  if (response.origin !== requested.origin) {
    throw new Error(
      `eip3009: refusing to sign after cross-origin redirect from ${requested.origin} to ${response.origin}`,
    )
  }
  return response.href
}

/**
 * Read PaymentRequirements from a 402 response body, if present.
 * Returns `null` when the body is unparseable or has no valid accepts.
 */
async function extractPaymentRequirements(
  res: Response,
): Promise<PaymentRequirements | null> {
  try {
    const body = (await res.clone().json()) as {
      accepts?: PaymentRequirements[]
    }
    const reqs = body.accepts?.[0]
    if (
      reqs?.payTo &&
      reqs.payTo !== "0x0000000000000000000000000000000000000000" &&
      reqs.scheme === "exact"
    ) {
      return reqs
    }
  } catch {
    // non-JSON body: nothing to extract
  }
  return null
}
