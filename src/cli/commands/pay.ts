import { Command } from "commander"
import pc from "picocolors"
import { type Address, getAddress } from "viem"
import { createExternalSignerAccount } from "../../lib/client/external-signer.js"
import { paidAuthenticatedFetch } from "../../lib/client/paid-authenticated-fetch.js"
import type { PaymentRequirements } from "../../lib/client/x402-payment.js"
import { signX402Payment } from "../../lib/client/x402-payment.js"
import { ToolManifestSchema } from "../../lib/manifest/schema.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletAdapter,
  type WalletProvider,
} from "../../lib/wallet/index.js"
import { getChain } from "./get-chain.js"
import { loadManifest } from "./load-manifest.js"
import { readInput } from "./read-input.js"

interface PayOptions {
  body?: string
  auth?: string
  manifest?: string
  chain?: string
  walletProvider?: string
}

export const payCommand = new Command("pay")
  .description(
    "Make a paid call to a tool endpoint via x402 (optionally with SIWE authentication)",
  )
  .argument("<url>", "Tool endpoint URL")
  .option("--body <json>", "JSON body (inline string or @path/to/file.json)")
  .option(
    "--auth <type>",
    "Authentication type (siwe). Auto-enabled when manifest declares an access block",
  )
  .option(
    "--manifest <path>",
    "Path to tool manifest (JSON or TS). If it declares an access block, SIWE auth is auto-enabled",
  )
  .option("--chain <name>", "Chain for SIWE message (default: base)", "base")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .action(async (url: string, options: PayOptions) => {
    let useSiwe = options.auth === "siwe"

    if (options.auth && options.auth !== "siwe") {
      console.error(
        pc.red(
          `Error: Unsupported --auth type "${options.auth}". Only "siwe" is supported.`,
        ),
      )
      process.exit(1)
    }

    if (options.manifest && !useSiwe) {
      const raw = await loadManifest(options.manifest)
      const parsed = ToolManifestSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn(
          pc.yellow(
            "Warning: --manifest did not match ToolManifestSchema — SIWE auto-detection skipped",
          ),
        )
      } else if (parsed.data.access) {
        useSiwe = true
        console.log(
          pc.cyan(
            "Manifest declares an access block — auto-enabling SIWE authentication",
          ),
        )
      }
    }

    let adapter: WalletAdapter
    try {
      adapter = options.walletProvider
        ? createWalletForProvider(options.walletProvider as WalletProvider)
        : createWalletFromEnv()
    } catch {
      console.error(
        pc.red(
          "Error: Set PRIVATE_KEY (or other wallet env vars) or use --wallet-provider",
        ),
      )
      process.exit(1)
    }

    const address = await adapter.getAddress()
    console.log(pc.cyan(`Wallet: ${address} (${adapter.name})`))

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

    if (useSiwe) {
      await runPaidAuthenticated(url, inputBody, adapter, options)
    } else {
      await runPaymentOnly(url, inputBody, adapter)
    }
  })

async function runPaidAuthenticated(
  url: string,
  inputBody: string,
  adapter: WalletAdapter,
  options: PayOptions,
): Promise<void> {
  const chain = getChain(options.chain ?? "base")
  const walletAddress = getAddress(await adapter.getAddress()) as Address
  const { signMessage } = adapter
  if (!signMessage) {
    console.error(
      pc.red(
        "Error: Selected wallet provider does not support message signing (required for SIWE)",
      ),
    )
    process.exit(1)
  }

  const account = createExternalSignerAccount({
    address: walletAddress,
    signMessage: async (message: string) => {
      const sig = await signMessage.call(adapter, { message })
      return sig as `0x${string}`
    },
  })

  console.log(pc.cyan("Sending SIWE-authenticated + paid request..."))

  let res: globalThis.Response
  try {
    res = await paidAuthenticatedFetch(url, {
      account,
      signer: adapter,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputBody,
      chainId: chain.id,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      console.error(pc.red("Error: Request timed out after 30s"))
    } else {
      console.error(pc.red("Error: paidAuthenticatedFetch failed"))
      console.error(pc.dim(err instanceof Error ? err.message : String(err)))
    }
    process.exit(1)
  }

  console.log(pc.cyan(`\nResponse (${res.status}):`))
  const responseText = await res.text()
  console.log(responseText)
}

async function runPaymentOnly(
  url: string,
  inputBody: string,
  adapter: WalletAdapter,
): Promise<void> {
  console.log(pc.cyan("Probing endpoint for payment requirements..."))

  let probeRes: globalThis.Response
  try {
    probeRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputBody,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.error(pc.red(`Error: Failed to reach ${url}`))
    console.error(pc.dim(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  if (probeRes.status !== 402) {
    console.log(
      pc.yellow(
        `Endpoint returned ${probeRes.status} (expected 402). Printing response:`,
      ),
    )
    const text = await probeRes.text()
    console.log(text)
    return
  }

  let probeBody: { accepts?: PaymentRequirements[] }
  try {
    probeBody = (await probeRes.json()) as {
      accepts?: PaymentRequirements[]
    }
  } catch {
    console.error(pc.red("Error: 402 response is not valid JSON"))
    process.exit(1)
  }

  const requirements = probeBody.accepts?.[0]
  if (!requirements) {
    console.error(
      pc.red("Error: 402 response missing accepts[0] payment requirements"),
    )
    process.exit(1)
  }

  console.log(pc.cyan("Payment requirements:"))
  console.log(`  Scheme: ${requirements.scheme}`)
  console.log(`  Network: ${requirements.network}`)
  console.log(`  Amount: ${requirements.maxAmountRequired}`)
  console.log(`  Pay To: ${requirements.payTo}`)
  console.log(`  Asset: ${requirements.asset}`)

  console.log(pc.cyan("\nSigning EIP-3009 transferWithAuthorization..."))

  const xPayment = await signX402Payment({
    signer: adapter,
    paymentRequirements: requirements,
  })

  console.log(pc.cyan("Replaying request with X-Payment header..."))

  let paidRes: globalThis.Response
  try {
    paidRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Payment": xPayment,
      },
      body: inputBody,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.error(pc.red("Error: Paid request failed"))
    console.error(pc.dim(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  console.log(pc.cyan(`\nResponse (${paidRes.status}):`))
  const responseText = await paidRes.text()
  console.log(responseText)
}
