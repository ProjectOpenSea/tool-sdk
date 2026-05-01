import type { WalletAdapter } from "@opensea/wallet-adapters"
import type { Account } from "viem"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"
import type { X402Network } from "../middleware/x402-facilitators.js"
import { createSiweAuthHeader, createSiweMessage } from "./siwe-auth.js"
import {
  type PaymentRequirements,
  signX402Payment,
} from "./x402-payment.js"

export interface PaidAuthenticatedFetchOptions extends RequestInit {
  account: Account
  signer?: WalletAdapter | Account
  expirationMinutes?: number
  chainId?: number
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
 * Combined SIWE-authenticated + x402-paid fetch for tools that use both a
 * predicate gate and a paywall.
 *
 * 1. Builds a SIWE message and signs it (like `authenticatedFetch`)
 * 2. Makes the initial POST with `Authorization: SIWE <token>`
 * 3. If the response is 402 with x402 payment requirements, signs the payment
 *    (like `paidFetch`)
 * 4. Retries the request with both `Authorization` and `X-Payment` headers
 * 5. Returns the final response
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
    expirationMinutes,
    chainId,
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

  const parsed = new URL(url)
  const domain = parsed.host
  const uri = parsed.href

  const message = createSiweMessage({
    account,
    domain,
    uri,
    expirationMinutes,
    chainId,
  })

  const signature = await account.signMessage({ message })
  const authHeader = createSiweAuthHeader(message, signature)

  const headers = {
    ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
    Authorization: authHeader,
  }

  const initialRes = await fetch(url, { ...fetchOptions, headers })

  if (initialRes.status !== 402) {
    return initialRes
  }

  let body: { accepts?: PaymentRequirements[] }
  try {
    body = await initialRes.json()
  } catch {
    throw new Error("x402: server returned 402 but body is not valid JSON")
  }

  const requirements = body.accepts?.[0]
  if (!requirements) {
    throw new Error(
      "x402: server returned 402 but body.accepts is missing or empty",
    )
  }

  validatePaymentSafety(requirements, {
    maxAmount,
    allowedRecipients,
    allowedAssets,
  })

  const paymentSigner = signer ?? account
  const xPayment = await signX402Payment({
    signer: paymentSigner,
    paymentRequirements: requirements,
  })

  const paidRes = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...headers,
      "X-Payment": xPayment,
    },
  })

  return paidRes
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
