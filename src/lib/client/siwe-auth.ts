import type { Account } from "viem"
import { toHex } from "viem"
import { createSiweMessage as viemCreateSiweMessage } from "viem/siwe"

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toHex(bytes).slice(2)
}

/**
 * Build a well-formed EIP-4361 SIWE message string.
 *
 * Uses viem's `createSiweMessage` under the hood. The returned string is
 * ready to be signed with `account.signMessage`.
 */
export function createSiweMessage(params: {
  account: Account
  domain: string
  uri: string
  statement?: string
  expirationMinutes?: number
  chainId?: number
  nonce?: string
}): string {
  const {
    account,
    domain,
    uri,
    statement = "Authenticate to access this tool",
    expirationMinutes = 5,
    chainId = 8453,
    nonce = generateNonce(),
  } = params

  if (expirationMinutes > 60) {
    throw new Error(
      "expirationMinutes must be ≤ 60 to limit replay exposure on stateless SIWE gates",
    )
  }

  const now = new Date()
  const expirationTime = new Date(now.getTime() + expirationMinutes * 60_000)

  return viemCreateSiweMessage({
    address: account.address,
    domain,
    uri,
    statement,
    version: "1",
    chainId,
    nonce,
    issuedAt: now,
    expirationTime,
  })
}

/**
 * Construct an `Authorization: SIWE <base64url(message)>.<signature>` header
 * value from a pre-signed SIWE message. Useful for agent wallets (Bankr, MPC,
 * HSM) that sign via an external API rather than a local viem Account.
 */
export function createSiweAuthHeader(
  message: string,
  signature: `0x${string}`,
): string {
  const encodedMessage = btoa(message)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `SIWE ${encodedMessage}.${signature}`
}

export interface AuthenticatedFetchOptions extends RequestInit {
  account: Account
  expirationMinutes?: number
  chainId?: number
}

/**
 * SIWE-authenticated fetch wrapper — the predicate-gate equivalent of
 * `paidFetch`. Works with both `predicateGate` (recommended) and the
 * deprecated `nftGate` middleware.
 *
 * Derives `domain` and `uri` from the `url` parameter, builds a SIWE message,
 * signs it, and sends the request with an `Authorization: SIWE <token>` header.
 *
 * Does NOT retry on 401/403 — SIWE auth is one-shot since the gate is
 * identity-based, not payment-based.
 */
export async function authenticatedFetch(
  url: string,
  options: AuthenticatedFetchOptions,
): Promise<Response> {
  const { account, expirationMinutes, chainId, ...fetchOptions } = options

  if (!account.signMessage) {
    throw new Error(
      "account.signMessage is required — use privateKeyToAccount, createExternalSignerAccount, or createBankrAccount",
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

  return fetch(url, {
    ...fetchOptions,
    headers: {
      ...Object.fromEntries(new Headers(fetchOptions.headers).entries()),
      Authorization: authHeader,
    },
  })
}
