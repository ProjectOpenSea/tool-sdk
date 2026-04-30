import type { WalletAdapter } from "@opensea/wallet-adapters"
import type { Account } from "viem"
import { toHex } from "viem"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"
import type { X402Network } from "../middleware/x402-facilitators.js"

const NETWORK_CHAIN_IDS: Record<X402Network, number> = {
  base: 8453,
  "base-sepolia": 84532,
}

const NETWORK_USDC: Record<X402Network, string> = {
  base: USDC_BASE_ADDRESS,
  "base-sepolia": USDC_BASE_SEPOLIA_ADDRESS,
}

const REJECTED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
])

export interface PaymentRequirements {
  scheme: string
  network: X402Network
  maxAmountRequired: string
  payTo: string
  asset: string
  extra?: { name?: string; version?: string }
}

/**
 * Sign an EIP-3009 `TransferWithAuthorization` for a USDC x402 payment.
 * Returns a base64-encoded JSON payment payload suitable for the `X-Payment`
 * header.
 */
export async function signX402Payment(params: {
  signer: WalletAdapter | Account
  paymentRequirements: PaymentRequirements
}): Promise<string> {
  const { signer, paymentRequirements: reqs } = params

  const chainId = NETWORK_CHAIN_IDS[reqs.network]
  if (chainId === undefined) {
    throw new Error(`Unsupported network: ${reqs.network}`)
  }

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

  const paymentPayload = {
    x402Version: 1,
    scheme: reqs.scheme,
    network: reqs.network,
    payload: { signature, authorization },
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
  const { signer, maxAmount, allowedRecipients, allowedAssets, ...fetchOptions } = options

  if (fetchOptions.body instanceof ReadableStream) {
    throw new Error(
      "paidFetch does not support ReadableStream bodies — pass a string or ArrayBuffer instead",
    )
  }

  const probeRes = await fetch(url, fetchOptions)

  if (probeRes.status !== 402) {
    return probeRes
  }

  let body: { accepts?: PaymentRequirements[] }
  try {
    body = await probeRes.json()
  } catch {
    throw new Error("x402: server returned 402 but body is not valid JSON")
  }

  const requirements = body.accepts?.[0]
  if (!requirements) {
    throw new Error(
      "x402: server returned 402 but body.accepts is missing or empty",
    )
  }

  validatePaymentRequirements(requirements, {
    maxAmount,
    allowedRecipients,
    allowedAssets,
  })

  const xPayment = await signX402Payment({ signer, paymentRequirements: requirements })

  const paidRes = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
      "X-Payment": xPayment,
    },
  })

  return paidRes
}

function validatePaymentRequirements(
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
