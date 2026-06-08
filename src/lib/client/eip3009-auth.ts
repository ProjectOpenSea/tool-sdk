import type { Account } from "viem"
import {
  type SignZeroValueAuthorizationParams,
  type ZeroValueAuthorization,
} from "../usage/eip3009-auth.js"
import {
  type PaymentRequirements,
  signX402Payment,
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
        const allowed = new Set(
          allowedRecipients.map((a) => a.toLowerCase()),
        )
        if (!allowed.has(requirements.payTo.toLowerCase())) {
          throw new Error(
            `eip3009: payTo address ${requirements.payTo} is not in allowedRecipients`,
          )
        }
      }
      const xPayment = await signX402Payment({
        signer: account,
        paymentRequirements: requirements,
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
