import { Command } from "commander"
import pc from "picocolors"
import type { Account } from "viem"
import { type Address, getAddress } from "viem"
import {
  type Eip3009AuthenticatedFetchOptions,
  eip3009AuthenticatedFetch,
} from "../../lib/client/eip3009-auth.js"
import {
  createBankrAccount,
  createExternalSignerAccount,
} from "../../lib/client/external-signer.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletAdapter,
  type WalletProvider,
} from "../../lib/wallet/index.js"
import { readInput } from "./read-input.js"

interface AuthOptions {
  body?: string
  bankrKey?: string
  walletProvider?: string
  chain?: string
}

export const authCommand = new Command("auth")
  .description(
    "Make an authenticated call to a predicate-gated tool endpoint via EIP-3009 zero-value authorization",
  )
  .argument("<url>", "Tool endpoint URL")
  .option("--body <json>", "JSON body (inline string or @path/to/file.json)")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option(
    "--bankr-key <api-key>",
    "Bankr API key for agent wallet signing (defaults to BANKR_API_KEY env var)",
  )
  .option(
    "--chain <name>",
    "Chain for EIP-3009 signature (default: base)",
    "base",
  )
  .action(async (url: string, options: AuthOptions) => {
    const bankrKey = options.bankrKey ?? process.env.BANKR_API_KEY

    let inputBody = "{}"
    if (options.body) {
      inputBody = readInput(options.body)
    } else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer)
      }
      const stdinData = Buffer.concat(chunks).toString("utf-8").trim()
      if (stdinData) {
        inputBody = stdinData
      }
    }

    try {
      JSON.parse(inputBody)
    } catch {
      console.error(pc.red("Error: Body is not valid JSON"))
      process.exit(1)
    }

    try {
      new URL(url)
    } catch {
      console.error(pc.red(`Error: Invalid URL: ${url}`))
      process.exit(1)
    }

    let account: Account

    if (bankrKey) {
      account = await createBankrAccount(bankrKey)
    } else {
      let adapter: WalletAdapter
      try {
        adapter = options.walletProvider
          ? createWalletForProvider(options.walletProvider as WalletProvider)
          : createWalletFromEnv()
      } catch {
        console.error(
          pc.red(
            "Error: Set PRIVATE_KEY (or other wallet env vars), use --wallet-provider, or pass --bankr-key / BANKR_API_KEY",
          ),
        )
        process.exit(1)
      }
      let address: Address
      try {
        address = getAddress(await adapter.getAddress()) as Address
      } catch (err) {
        console.error(pc.red("Error: Failed to retrieve wallet address"))
        console.error(pc.dim(err instanceof Error ? err.message : String(err)))
        process.exit(1)
      }
      const { signMessage, signTypedData } = adapter
      if (!signTypedData) {
        console.error(
          pc.red(
            "Error: Selected wallet provider does not support typed data signing (required for EIP-3009 auth)",
          ),
        )
        process.exit(1)
      }
      account = createExternalSignerAccount({
        address,
        signMessage: signMessage
          ? async (message: string) => {
              const sig = await signMessage.call(adapter, { message })
              return sig as `0x${string}`
            }
          : async () => {
              throw new Error("Wallet does not support message signing")
            },
        signTypedData: signTypedData
          ? async (typedData: unknown) => {
              const td = typedData as {
                domain: Record<string, unknown>
                types: Record<string, Array<{ name: string; type: string }>>
                primaryType: string
                message: Record<string, unknown>
              }
              const sig = await signTypedData.call(adapter, td)
              return sig as `0x${string}`
            }
          : undefined,
      })
    }

    const { getChain } = await import("./get-chain.js")
    const chain = getChain(options.chain ?? "base")

    console.log(pc.cyan("Building EIP-3009 zero-value authorization..."))
    console.log(`  Address: ${account.address}`)
    console.log(`  Chain:   ${chain.name} (${chain.id})`)

    console.log(
      pc.cyan(`\nSigning and sending authenticated request to ${url}...\n`),
    )

    const fetchOptions: Eip3009AuthenticatedFetchOptions = {
      account,
      chainId: chain.id,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputBody,
      signal: AbortSignal.timeout(30_000),
    }

    let res: globalThis.Response
    try {
      res = await eip3009AuthenticatedFetch(url, fetchOptions)
    } catch (err) {
      console.error(pc.red(`Error: Failed to reach ${url}`))
      console.error(pc.dim(err instanceof Error ? err.message : String(err)))
      process.exit(1)
    }

    console.log(`Status: ${res.status}`)
    const responseText = await res.text()
    console.log(responseText)

    if (res.status === 401) {
      console.log(
        pc.yellow(
          "\nAuthentication failed — check that your wallet key is correct and the EIP-3009 signature is valid",
        ),
      )
    } else if (res.status === 403) {
      let hint =
        "Access denied — your wallet does not satisfy the tool's access predicate."
      try {
        const body = JSON.parse(responseText) as {
          predicate?: string
          toolId?: string
        }
        if (body.predicate) {
          hint += ` The predicate at ${body.predicate} denied access.`
        }
        if (body.toolId) {
          hint += ` Check requirements with tool-sdk inspect --tool-id ${body.toolId}`
        }
      } catch {
        hint +=
          " Run `tool-sdk inspect` with the tool ID to see the predicate requirements."
      }
      console.log(pc.yellow(`\n${hint}`))
    }
  })
