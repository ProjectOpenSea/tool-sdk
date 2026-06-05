import type { Account, WalletClient } from "viem"
import { toHex } from "viem"

/** Canonical USDC contract addresses per chain. */
export const NETWORK_USDC: Record<number, `0x${string}`> = {
  1: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  137: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  42161: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  10: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  43114: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
}

const AUTH_TTL_SECONDS = 5 * 60 // 5 minutes
const VALID_AFTER_OFFSET_SECONDS = 60 // valid_after = now - 60s

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const

export interface SignZeroValueAuthorizationParams {
  walletClient: WalletClient
  from: `0x${string}`
  to: `0x${string}`
  chainId: number
  tokenAddress?: `0x${string}`
}

export interface ZeroValueAuthorization {
  signature: `0x${string}`
  from: `0x${string}`
  to: `0x${string}`
  value: "0"
  validAfter: string
  validBefore: string
  nonce: `0x${string}`
  chainId: number
}

/**
 * Signs a zero-value EIP-3009 `TransferWithAuthorization` for usage tracking.
 * The signed authorization proves the caller controls `from` without moving
 * any tokens — `value` is always 0. The aggregator verifies the EIP-712
 * signature to attribute tool calls to unique callers.
 */
export async function signZeroValueAuthorization(
  params: SignZeroValueAuthorizationParams,
): Promise<ZeroValueAuthorization> {
  const { walletClient, from, to, chainId } = params
  const tokenAddress =
    (params.tokenAddress ?? NETWORK_USDC[chainId]) as `0x${string}` | undefined
  if (!tokenAddress) {
    throw new Error(
      `No USDC token address known for chainId ${chainId}. Pass tokenAddress explicitly.`,
    )
  }

  const nonceBytes = new Uint8Array(32)
  crypto.getRandomValues(nonceBytes)
  const nonce = toHex(nonceBytes)

  const account = walletClient.account
  if (!account) {
    throw new Error(
      "walletClient must have an account — use createWalletClient with an account",
    )
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const validAfter = BigInt(nowSec - VALID_AFTER_OFFSET_SECONDS)
  const validBefore = BigInt(nowSec + AUTH_TTL_SECONDS)

  const signature = await walletClient.signTypedData({
    account: account as Account,
    domain: {
      name: "USD Coin",
      version: "2",
      chainId,
      verifyingContract: tokenAddress,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to,
      value: 0n,
      validAfter,
      validBefore,
      nonce,
    },
  })

  return {
    signature,
    from,
    to,
    value: "0",
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
    chainId,
  }
}
