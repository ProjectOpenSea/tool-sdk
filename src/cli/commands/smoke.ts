import { Command } from "commander"
import pc from "picocolors"
import { type Address, getAddress } from "viem"
import { createExternalSignerAccount } from "../../lib/client/external-signer.js"
import { authenticatedFetch } from "../../lib/client/siwe-auth.js"
import type { PaymentRequirements } from "../../lib/client/x402-payment.js"
import { signX402Payment } from "../../lib/client/x402-payment.js"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
  type X402Network,
} from "../../lib/middleware/x402-facilitators.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletAdapter,
  type WalletProvider,
} from "../../lib/wallet/index.js"
import { getChain } from "./get-chain.js"
import { printProbeResult, probeEndpoint } from "./probe-endpoint.js"
import { readInput } from "./read-input.js"

const NETWORK_USDC: Record<X402Network, string> = {
  base: USDC_BASE_ADDRESS,
  "base-sepolia": USDC_BASE_SEPOLIA_ADDRESS,
}

// 1 USDC (6 decimals)
const DEFAULT_MAX_AMOUNT = "1000000"

interface SmokeOptions {
  toolId?: string
  endpoint: string
  input?: string
  expect?: string
  chain?: string
  paid?: boolean
  walletProvider?: string
  maxAmount?: string
}

export const smokeCommand = new Command("smoke")
  .description(
    "Smoke-test a live tool endpoint: SIWE-sign, send an authenticated request, and assert the HTTP status",
  )
  .option("--tool-id <id>", "Onchain tool ID (included in log output)")
  .requiredOption("--endpoint <url>", "Production endpoint URL")
  .option("--input <json>", "JSON body (inline or @path)", "{}")
  .option("--expect <status>", "Expected HTTP status code", "200")
  .option("--chain <name>", "Chain for wallet client and SIWE message", "base")
  .option("--paid", "Handle x402 payment challenge after SIWE authentication")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option(
    "--max-amount <amount>",
    "Maximum payment amount in base units (default: 1000000 = 1 USDC)",
  )
  .action(async (options: SmokeOptions) => {
    const expectedStatus = Number.parseInt(options.expect ?? "200", 10)
    if (
      Number.isNaN(expectedStatus) ||
      expectedStatus < 100 ||
      expectedStatus > 599
    ) {
      console.error(
        pc.red(
          `Error: --expect must be a valid HTTP status code (got ${options.expect})`,
        ),
      )
      process.exit(1)
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(options.endpoint)
    } catch {
      console.error(pc.red(`Error: Invalid endpoint URL: ${options.endpoint}`))
      process.exit(1)
    }

    let toolId: bigint | undefined
    if (options.toolId) {
      try {
        toolId = BigInt(options.toolId)
      } catch {
        console.error(
          pc.red(
            `Error: --tool-id must be a valid integer (got ${options.toolId})`,
          ),
        )
        process.exit(1)
      }

      if (toolId < 0n) {
        console.error(
          pc.red(
            `Error: --tool-id must be a non-negative integer (got ${options.toolId})`,
          ),
        )
        process.exit(1)
      }
    }

    let inputBody = "{}"
    if (options.input) {
      inputBody = readInput(options.input)
    }

    try {
      JSON.parse(inputBody)
    } catch {
      console.error(pc.red("Error: --input is not valid JSON"))
      process.exit(1)
    }

    const chain = getChain(options.chain ?? "base")

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
    let address: Address
    try {
      address = getAddress(await adapter.getAddress()) as Address
    } catch (err) {
      console.error(pc.red("Error: Failed to retrieve wallet address"))
      console.error(pc.dim(err instanceof Error ? err.message : String(err)))
      process.exit(1)
    }
    const { signMessage } = adapter
    if (!signMessage) {
      console.error(
        pc.red(
          "Error: Selected wallet provider does not support message signing",
        ),
      )
      process.exit(1)
    }
    const account = createExternalSignerAccount({
      address,
      signMessage: async (message: string) => {
        const sig = await signMessage.call(adapter, { message })
        return sig as `0x${string}`
      },
    })

    console.log(pc.cyan("Smoke test configuration:"))
    if (toolId !== undefined) {
      console.log(`  Tool ID:  ${toolId.toString()}`)
    }
    console.log(`  Endpoint: ${parsedUrl.href}`)
    console.log(`  Wallet:   ${account.address}`)
    console.log(`  Chain:    ${chain.name} (${chain.id})`)
    console.log(`  Expected: HTTP ${expectedStatus}`)

    console.log(pc.cyan("\nProbing endpoint before SIWE signing...\n"))

    const probeResult = await probeEndpoint(parsedUrl.href)
    printProbeResult(probeResult)

    if (probeResult.level === "fail") {
      process.exit(1)
    }

    if (options.paid) {
      console.log(
        pc.cyan(
          "\nBuilding SIWE message and sending authenticated request...\n",
        ),
      )

      let initialRes: globalThis.Response
      try {
        initialRes = await authenticatedFetch(parsedUrl.href, {
          account,
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
          console.error(pc.red(`Error: Failed to reach ${options.endpoint}`))
          console.error(
            pc.dim(err instanceof Error ? err.message : String(err)),
          )
        }
        process.exit(1)
      }

      if (initialRes.status !== 402) {
        await printResult(initialRes, expectedStatus)
        return
      }

      let probeBody: { accepts?: PaymentRequirements[] }
      try {
        probeBody = (await initialRes.json()) as {
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
      console.log(`  Scheme:  ${requirements.scheme}`)
      console.log(`  Network: ${requirements.network}`)
      console.log(`  Amount:  ${requirements.maxAmountRequired}`)
      console.log(`  Pay To:  ${requirements.payTo}`)
      console.log(`  Asset:   ${requirements.asset}`)

      const expectedUsdc = NETWORK_USDC[requirements.network]
      if (
        expectedUsdc &&
        requirements.asset.toLowerCase() !== expectedUsdc.toLowerCase()
      ) {
        console.error(
          pc.red(
            `Error: asset ${requirements.asset} does not match expected USDC address for ${requirements.network} (${expectedUsdc})`,
          ),
        )
        process.exit(1)
      }

      const maxAmount = options.maxAmount ?? DEFAULT_MAX_AMOUNT
      if (BigInt(requirements.maxAmountRequired) > BigInt(maxAmount)) {
        console.error(
          pc.red(
            `Error: server requested ${requirements.maxAmountRequired} but max allowed is ${maxAmount} (use --max-amount to override)`,
          ),
        )
        process.exit(1)
      }

      console.log(pc.cyan("\nSigning x402 payment..."))

      const xPayment = await signX402Payment({
        signer: adapter,
        paymentRequirements: requirements,
      })

      console.log(
        pc.cyan("Replaying request with SIWE auth + X-Payment headers..."),
      )

      let paidRes: globalThis.Response
      try {
        paidRes = await authenticatedFetch(parsedUrl.href, {
          account,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Payment": xPayment,
          },
          body: inputBody,
          chainId: chain.id,
          signal: AbortSignal.timeout(30_000),
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          console.error(pc.red("Error: Request timed out after 30s"))
        } else {
          console.error(pc.red("Error: Paid request failed"))
          console.error(
            pc.dim(err instanceof Error ? err.message : String(err)),
          )
        }
        process.exit(1)
      }

      await printResult(paidRes, expectedStatus)
    } else {
      console.log(pc.cyan("\nBuilding SIWE message and sending request...\n"))

      let res: globalThis.Response
      try {
        res = await authenticatedFetch(parsedUrl.href, {
          account,
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
          console.error(pc.red(`Error: Failed to reach ${options.endpoint}`))
          console.error(
            pc.dim(err instanceof Error ? err.message : String(err)),
          )
        }
        process.exit(1)
      }

      await printResult(res, expectedStatus)
    }
  })

async function printResult(
  res: globalThis.Response,
  expectedStatus: number,
): Promise<void> {
  console.log(`Status: ${res.status}`)

  const responseText = await res.text()
  if (responseText) {
    try {
      const json = JSON.parse(responseText)
      console.log(JSON.stringify(json, null, 2))
    } catch {
      console.log(responseText)
    }
  }

  if (res.status === expectedStatus) {
    console.log(
      pc.green(
        `\nPASS: Status ${res.status} matches expected ${expectedStatus}`,
      ),
    )
  } else {
    console.error(
      pc.red(`\nFAIL: Expected status ${expectedStatus}, got ${res.status}`),
    )
    process.exit(1)
  }
}
