import type { WalletAdapter } from "@opensea/wallet-adapters"
import { x402HTTPClient } from "@x402/core/client"
import type { Account } from "viem"
import type { CallerUsageReporterConfig } from "../usage/caller-reporter.js"
import { reportCallerX402Usage } from "../usage/caller-reporter.js"
import { parseX402Challenge, resolveNetwork } from "./x402-challenge.js"
import {
  createX402Client,
  extractSettlementTxHash,
  rejectServerErrorAfterPayment,
  validatePaymentRequirements,
} from "./x402-payment.js"
import { toX402PaymentRequired } from "./x402-scheme.js"

export interface PaidAuthenticatedFetchOptions extends RequestInit {
  account: Account
  signer?: WalletAdapter | Account
  /** @deprecated Ignored — EIP-3009 does not use expiration minutes. */
  expirationMinutes?: number
  maxAmount?: string
  allowedRecipients?: string[]
  allowedAssets?: string[]
  /**
   * When set, sends a fire-and-forget caller-side usage report after a
   * successful x402 payment. The tool is identified by endpoint URL.
   */
  reportCallerUsage?: CallerUsageReporterConfig | boolean
}

/**
 * Combined predicate-gate + x402-paid fetch. Handles multiple 402
 * challenges (predicate gate's zero-value challenge, then x402's real
 * payment challenge) via a retry loop.
 *
 * `body` must be a string, `ArrayBuffer`, or other re-readable type.
 * `ReadableStream` bodies are not supported (the body is consumed twice).
 */
export async function paidAuthenticatedFetch(
  url: string,
  options: PaidAuthenticatedFetchOptions,
): Promise<Response> {
  const {
    account,
    signer,
    expirationMinutes: _expirationMinutes,
    maxAmount,
    allowedRecipients,
    allowedAssets,
    reportCallerUsage,
    ...fetchOptions
  } = options

  if (!account.signMessage) {
    throw new Error(
      "account.signMessage is required — use privateKeyToAccount, createExternalSignerAccount, or createBankrAccount",
    )
  }

  if (fetchOptions.body instanceof ReadableStream) {
    throw new Error(
      "paidAuthenticatedFetch does not support ReadableStream bodies — pass a string or ArrayBuffer instead",
    )
  }

  const baseHeaders = Object.fromEntries(
    new Headers(fetchOptions.headers).entries(),
  )

  const paymentSigner = signer ?? account
  const MAX_402_RETRIES = 2
  let res = await fetch(url, { ...fetchOptions, headers: baseHeaders })

  // maxAmount is a per-invocation spending cap. The two-challenge loop only
  // exists for the legacy predicate-gate flow (zero-value challenge, then the
  // real paid challenge) — so at most one nonzero authorization may be signed
  // per invocation, and cumulative authorized value may never exceed maxAmount.
  let cumulativeAuthorized = 0n
  let nonzeroAuthorizationSigned = false

  for (let i = 0; i < MAX_402_RETRIES && res.status === 402; i++) {
    // Handles both x402 wire formats: v1 (challenge in body) and v2 (challenge
    // in the PAYMENT-REQUIRED header, signed payload in PAYMENT-SIGNATURE).
    const parsed = await parseX402Challenge(res)
    if (!parsed.ok) {
      throw new Error(`${parsed.reason} (attempt ${i + 1}/${MAX_402_RETRIES})`)
    }
    const { requirements, x402Version, raw, resource } = parsed

    validatePaymentRequirements(requirements, {
      maxAmount,
      allowedRecipients,
      allowedAssets,
    })

    const requestedAmount = BigInt(requirements.maxAmountRequired)

    if (nonzeroAuthorizationSigned) {
      throw new Error(
        "x402: refusing to sign another challenge after a payment authorization was already signed in this call",
      )
    }

    if (
      maxAmount !== undefined &&
      cumulativeAuthorized + requestedAmount > BigInt(maxAmount)
    ) {
      throw new Error(
        `x402: cumulative authorized amount ${cumulativeAuthorized + requestedAmount} would exceed maxAmount ${maxAmount}`,
      )
    }

    const client = createX402Client(
      paymentSigner,
      requirements.network,
      x402Version,
    )
    const httpClient = new x402HTTPClient(client)

    const paymentRequired = toX402PaymentRequired({
      requirements,
      x402Version,
      raw,
      resource,
    })
    const paymentPayload = await client.createPaymentPayload(paymentRequired)
    cumulativeAuthorized += requestedAmount
    if (requestedAmount > 0n) {
      nonzeroAuthorizationSigned = true
    }
    const paymentHeaders =
      httpClient.encodePaymentSignatureHeader(paymentPayload)

    res = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...baseHeaders,
        ...paymentHeaders,
      },
    })

    rejectServerErrorAfterPayment(res)

    if (reportCallerUsage && res.ok) {
      const settlement = extractSettlementTxHash(res)
      const resolved = resolveNetwork(requirements.network)
      if (settlement && resolved) {
        const config =
          typeof reportCallerUsage === "object" ? reportCallerUsage : {}
        reportCallerX402Usage(
          {
            toolEndpoint: url,
            callerAddress: account.address,
            txHash: settlement,
            chainId: resolved.chainId,
          },
          config,
        ).catch(() => {})
      }
    }
  }

  return res
}
