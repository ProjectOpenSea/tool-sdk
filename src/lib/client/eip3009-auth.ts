import type { Account, WalletClient } from "viem"
import { createWalletClient, http } from "viem"
import { base, baseSepolia } from "viem/chains"
import {
  type SignZeroValueAuthorizationParams,
  type ZeroValueAuthorization,
  signZeroValueAuthorization,
} from "../usage/eip3009-auth.js"

export type { SignZeroValueAuthorizationParams, ZeroValueAuthorization }

export interface Eip3009AuthenticatedFetchOptions extends RequestInit {
  account: Account
  /**
   * Tool operator address used as the `to` field in the zero-value
   * authorization. Provides domain binding so signatures are scoped to a
   * specific tool operator. Falls back to `0x0` when omitted.
   */
  to?: `0x${string}`
  chainId?: number
}

export const EIP3009_CHAIN_MAP: Record<number, (typeof base | typeof baseSepolia)> = {
  8453: base,
  84532: baseSepolia,
}

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as `0x${string}`

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
 * EIP-3009-authenticated fetch wrapper — the predicate-gate counterpart of
 * `paidFetch`. Signs a zero-value `TransferWithAuthorization` proving the
 * caller controls `account.address`, then sends the request with an
 * `Authorization: EIP-3009 <token>` header.
 *
 * This replaces the deprecated `authenticatedFetch` (SIWE-based). Unlike
 * SIWE, EIP-3009 verification is pure `ecrecover` on EIP-712 typed data —
 * no RPC call needed on the server side.
 */
export async function eip3009AuthenticatedFetch(
  url: string,
  options: Eip3009AuthenticatedFetchOptions,
): Promise<Response> {
  const { account, to, chainId = 8453, ...fetchOptions } = options

  const chain = EIP3009_CHAIN_MAP[chainId]
  if (!chain) {
    throw new Error(
      `Unsupported chainId ${chainId} for EIP-3009 auth. Supported: ${Object.keys(EIP3009_CHAIN_MAP).join(", ")}`,
    )
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  })

  const authorization = await signZeroValueAuthorization({
    walletClient,
    from: account.address,
    to: to ?? ZERO_ADDRESS,
    chainId,
  })

  const authHeader = createEip3009AuthHeader(authorization)

  return fetch(url, {
    ...fetchOptions,
    headers: {
      ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
      Authorization: authHeader,
    },
  })
}
