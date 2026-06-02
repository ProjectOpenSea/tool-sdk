import type { Account, WalletClient } from "viem"
import { toHex } from "viem"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"

const NETWORK_USDC: Record<number, string> = {
  8453: USDC_BASE_ADDRESS,
  84532: USDC_BASE_SEPOLIA_ADDRESS,
}

const AUTH_TTL_SECONDS = 5 * 60 // 5 minutes

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
  validAfter: "0"
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
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS),
      nonce,
    },
  })

  return {
    signature,
    from,
    to,
    value: "0",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS),
    nonce,
    chainId,
  }
}
