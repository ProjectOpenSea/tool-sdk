import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Command } from "commander"
import pc from "picocolors"
import type { PaymentRequirements } from "../../lib/client/x402-payment.js"
import { signX402Payment } from "../../lib/client/x402-payment.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletProvider,
} from "../../lib/wallet/index.js"

interface PayOptions {
  body?: string
  walletProvider?: string
}

function readBody(raw: string): string {
  if (raw.startsWith("@")) {
    const filePath = resolve(process.cwd(), raw.slice(1))
    try {
      return readFileSync(filePath, "utf-8")
    } catch {
      console.error(pc.red(`Error: Could not read file ${filePath}`))
      process.exit(1)
    }
  }
  return raw
}

export const payCommand = new Command("pay")
  .description("Make a paid call to a tool endpoint via x402")
  .argument("<url>", "Tool endpoint URL")
  .option("--body <json>", "JSON body (inline string or @path/to/file.json)")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .action(async (url: string, options: PayOptions) => {
    const wallet = options.walletProvider
      ? createWalletForProvider(options.walletProvider as WalletProvider)
      : createWalletFromEnv()

    const address = await wallet.getAddress()
    console.log(pc.cyan(`Wallet: ${address} (${wallet.name})`))

    let inputBody = "{}"
    if (options.body) {
      inputBody = readBody(options.body)
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
      signer: wallet,
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
  })
