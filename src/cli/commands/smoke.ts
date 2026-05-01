import { Command } from "commander"
import pc from "picocolors"
import { privateKeyToAccount } from "viem/accounts"
import { authenticatedFetch } from "../../lib/client/siwe-auth.js"
import { getChain } from "./get-chain.js"
import { readInput } from "./read-input.js"

interface SmokeOptions {
  toolId?: string
  endpoint: string
  as?: string
  input?: string
  expect?: string
  chain?: string
}

export const smokeCommand = new Command("smoke")
  .description(
    "Smoke-test a live tool endpoint: SIWE-sign, send an authenticated request, and assert the HTTP status",
  )
  .option("--tool-id <id>", "Onchain tool ID (included in log output)")
  .requiredOption("--endpoint <url>", "Production endpoint URL")
  .option(
    "--as <private-key>",
    "Private key to sign SIWE with (defaults to TOOL_SDK_PRIVATE_KEY env var). WARNING: CLI args may appear in shell history and process listings; prefer the env var for production use",
  )
  .option("--input <json>", "JSON body (inline or @path)", "{}")
  .option("--expect <status>", "Expected HTTP status code", "200")
  .option("--chain <name>", "Chain for SIWE message", "base")
  .action(async (options: SmokeOptions) => {
    const privateKey = options.as ?? process.env.TOOL_SDK_PRIVATE_KEY
    if (!privateKey) {
      console.error(
        pc.red("Error: Provide --as or set the TOOL_SDK_PRIVATE_KEY env var"),
      )
      process.exit(1)
    }

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
    const account = privateKeyToAccount(privateKey as `0x${string}`)

    console.log(pc.cyan("Smoke test configuration:"))
    if (toolId !== undefined) {
      console.log(`  Tool ID:  ${toolId.toString()}`)
    }
    console.log(`  Endpoint: ${parsedUrl.href}`)
    console.log(`  Wallet:   ${account.address}`)
    console.log(`  Chain:    ${chain.name} (${chain.id})`)
    console.log(`  Expected: HTTP ${expectedStatus}`)

    console.log(pc.cyan("\nBuilding SIWE message and sending request...\n"))

    let res: globalThis.Response
    try {
      res = await authenticatedFetch(options.endpoint, {
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
        console.error(pc.dim(err instanceof Error ? err.message : String(err)))
      }
      process.exit(1)
    }

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
  })
