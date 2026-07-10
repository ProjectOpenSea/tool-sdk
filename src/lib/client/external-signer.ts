import type { Account, Address } from "viem"
import { getAddress } from "viem"
import { toAccount } from "viem/accounts"

const BANKR_API_BASE = "https://api.bankr.bot"

/**
 * Wrap an external signing function into a viem-compatible {@link Account}.
 *
 * This lets agent wallets (Bankr, MPC, HSM) that sign via HTTP API work with
 * {@link authenticatedFetch} and any other viem consumer without requiring a
 * local private key.
 */
export function createExternalSignerAccount(params: {
  address: Address
  signMessage: (message: string) => Promise<`0x${string}`>
  signTypedData?: (typedData: unknown) => Promise<`0x${string}`>
}): Account {
  return toAccount({
    address: params.address,
    signMessage: async ({ message }) => {
      if (typeof message !== "string") {
        throw new Error(
          "createExternalSignerAccount only supports string messages (personal_sign)",
        )
      }
      return params.signMessage(message)
    },
    signTransaction: async () => {
      throw new Error(
        "createExternalSignerAccount does not support signTransaction — use it for EIP-3009 auth only",
      )
    },
    signTypedData: async typedData => {
      if (!params.signTypedData) {
        throw new Error(
          "signTypedData not provided to createExternalSignerAccount",
        )
      }
      return params.signTypedData(typedData)
    },
  })
}

/**
 * Create a viem Account backed by the Bankr wallet HTTP API.
 * Fetches the signer address from `/wallet/me` and signs via `/wallet/sign`.
 */
export async function createBankrAccount(apiKey: string): Promise<Account> {
  const infoRes = await fetch(`${BANKR_API_BASE}/wallet/me`, {
    headers: { "X-API-Key": apiKey },
  })
  if (!infoRes.ok) {
    const text = await infoRes.text()
    throw new Error(`Bankr /wallet/me failed (${infoRes.status}): ${text}`)
  }
  // `/wallet/me` returns `{ wallets: [{ chain, address }, ...] }` — one entry
  // per chain (e.g. "evm", "solana"). There is no top-level `address` field.
  const info = (await infoRes.json()) as {
    wallets?: Array<{ chain: string; address: string }>
  }
  const evmWallet = info.wallets?.find(w => w.chain === "evm")
  if (!evmWallet) {
    throw new Error("Bankr /wallet/me returned no EVM wallet address")
  }
  const address = getAddress(evmWallet.address)

  return createExternalSignerAccount({
    address,
    signMessage: async message => {
      const signRes = await fetch(`${BANKR_API_BASE}/wallet/sign`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          signatureType: "personal_sign",
          message,
        }),
      })
      if (!signRes.ok) {
        const text = await signRes.text()
        throw new Error(
          `Bankr /wallet/sign failed (${signRes.status}): ${text}`,
        )
      }
      const data = (await signRes.json()) as { signature: `0x${string}` }
      return data.signature
    },
    signTypedData: async (typedData: unknown) => {
      const td = typedData as {
        domain: Record<string, unknown>
        types: Record<string, Array<{ name: string; type: string }>>
        primaryType: string
        message: Record<string, unknown>
      }
      // Bankr API expects JSON — convert BigInt values to strings
      const replacer = (_k: string, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v
      const signRes = await fetch(`${BANKR_API_BASE}/wallet/sign`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          {
            signatureType: "eth_signTypedData_v4",
            typedData: {
              domain: td.domain,
              types: td.types,
              primaryType: td.primaryType,
              message: td.message,
            },
          },
          replacer,
        ),
      })
      if (!signRes.ok) {
        const text = await signRes.text()
        throw new Error(
          `Bankr /wallet/sign failed (${signRes.status}): ${text}`,
        )
      }
      const data = (await signRes.json()) as { signature: `0x${string}` }
      return data.signature
    },
  })
}
