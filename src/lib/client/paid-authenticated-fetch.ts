import type { WalletAdapter } from "@opensea/wallet-adapters"
import type { Account } from "viem"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"
import type { X402Network } from "../middleware/x402-facilitators.js"
import {
  type PaymentRequirements,
  signX402Payment,
} from "./x402-payment.js"

export interface PaidAuthenticatedFetchOptions extends RequestInit {
  account: Account
  signer?: WalletAdapter | Account
  /** @deprecated Ignored — EIP-3009 does not use expiration minutes. */
  expirationMinutes?: number
  maxAmount?: string
  allowedRecipients?: string[]
  allowedAssets?: string[]
}

// Keep in sync with REJECTED_ADDRESSES in x402-payment.ts
const REJECTED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
])

// Keep in sync with NETWORK_USDC in x402-payment.ts
const NETWORK_USDC: Record<X402Network, string> = {
  base: USDC_BASE_ADDRESS,
  "base-sepolia": USDC_BASE_SEPOLIA_ADDRESS,
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

  for (let i = 0; i < MAX_402_RETRIES && res.status === 402; i++) {
    let body: { accepts?: PaymentRequirements[] }
    try {
      body = await res.json()
    } catch {
      throw new Error("x402: server returned 402 but body is not valid JSON")
    }

    const requirements = body.accepts?.[0]
    if (!requirements) {
      throw new Error(
        `x402: server returned 402 (attempt ${i + 1}/${MAX_402_RETRIES}) but body.accepts is missing or empty`,
      )
    }

    validatePaymentSafety(requirements, {
      maxAmount,
      allowedRecipients,
      allowedAssets,
    })

    const xPayment = await signX402Payment({
      signer: paymentSigner,
      paymentRequirements: requirements,
    })

    res = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...baseHeaders,
        "X-Payment": xPayment,
      },
    })
  }

  return res
}

function validatePaymentSafety(
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
    const expectedUsdc = NETWORK_USDC[reqs.network]
    if (expectedUsdc && assetLower !== expectedUsdc.toLowerCase()) {
      throw new Error(
        `x402: asset ${reqs.asset} does not match expected USDC address for ${reqs.network} (${expectedUsdc})`,
      )
    }
  }
}
