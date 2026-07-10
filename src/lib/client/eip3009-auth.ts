import type { Account } from "viem"
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
 * header value. The payload is base64url-encoded JSON for consistency with
 * the SIWE auth scheme.
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
 * using the advertised `payTo` and retries once.
 *
 * This is an identity-only flow: the signed authorization always has
 * `value: 0`, so no USDC can move. If the challenge requests a non-zero
 * amount, nothing is signed and the 402 response is returned as-is — use
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
        // unparseable amount — treat as non-zero and refuse to sign
      }
      if (!isZeroAmount) {
        // The endpoint is asking for a real payment. This flow only proves
        // identity, so return the 402 untouched rather than signing an
        // authorization that could move USDC.
        return res
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
      return fetch(url, {
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
    // non-JSON body — nothing to extract
  }
  return null
}
