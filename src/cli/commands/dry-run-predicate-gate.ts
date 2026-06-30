import { Command } from "commander"
import pc from "picocolors"
import { z } from "zod/v4"
import { createToolHandler } from "../../lib/handler/index.js"
import { validateManifest } from "../../lib/manifest/index.js"
import { predicateGate } from "../../lib/middleware/predicate-gate.js"
import { loadManifest } from "./load-manifest.js"
import { readInput } from "./read-input.js"

interface DryRunPredicateGateOptions {
  manifest: string
  toolId?: string
  operatorAddress?: string
  input?: string
}

export const dryRunPredicateGateCommand = new Command("dry-run-predicate-gate")
  .description(
    "Invoke a tool handler locally with no X-Payment header and assert a valid 402 challenge response",
  )
  .option("--manifest <path>", "Path to manifest .ts or .json file (required)")
  .option("--tool-id <id>", "Onchain tool ID to configure in the gate")
  .requiredOption(
    "--operator-address <address>",
    "Operator address (0x-prefixed) for the 402 challenge",
  )
  .option("--input <json>", "JSON input body (inline or @path)")
  .action(async (options: DryRunPredicateGateOptions) => {
    if (!options.manifest) {
      console.error(pc.red("Error: --manifest is required"))
      process.exit(1)
    }

    if (
      !options.operatorAddress ||
      !/^0x[0-9a-fA-F]{40}$/.test(options.operatorAddress)
    ) {
      console.error(
        pc.red(
          "Error: --operator-address must be a valid 0x-prefixed Ethereum address",
        ),
      )
      process.exit(1)
    }

    console.log(pc.cyan("Loading manifest..."))
    const data = await loadManifest(options.manifest)
    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("Error: Manifest validation failed"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    const manifest = result.data

    const toolIdRaw = options.toolId ?? "0"
    let toolId: bigint
    try {
      toolId = BigInt(toolIdRaw)
    } catch {
      console.error(
        pc.red(`Error: --tool-id must be a valid integer (got ${toolIdRaw})`),
      )
      process.exit(1)
    }

    if (toolId < 0n) {
      console.error(
        pc.red(
          `Error: --tool-id must be a non-negative integer (got ${toolIdRaw})`,
        ),
      )
      process.exit(1)
    }

    console.log(
      pc.cyan(`Building predicate gate (toolId: ${toolId.toString()})...`),
    )
    const gate = predicateGate({
      toolId,
      operatorAddress: options.operatorAddress as `0x${string}`,
    })

    const handler = createToolHandler({
      manifest,
      inputSchema: z.any(),
      outputSchema: z.any(),
      gates: [gate],
      handler: async input => input,
    })

    let inputBody = "{}"
    if (options.input) {
      inputBody = readInput(options.input)
    }

    try {
      JSON.parse(inputBody)
    } catch {
      console.error(pc.red("Error: Input is not valid JSON"))
      process.exit(1)
    }

    console.log(pc.cyan("Invoking handler with no X-Payment header...\n"))

    const request = new Request(manifest.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputBody,
    })

    const res = await handler(request)

    if (res.status !== 402) {
      console.error(pc.red(`FAIL: Expected status 402, got ${res.status}`))
      const text = await res.text()
      if (text) console.error(pc.dim(text))
      process.exit(1)
    }

    console.log(pc.green("Status: 402 (correct)"))

    let body: {
      x402Version?: number
      accepts?: Array<{ payTo?: string; maxAmountRequired?: string }>
      error?: string
    }
    try {
      body = (await res.json()) as typeof body
    } catch {
      console.error(pc.red("FAIL: 402 response body is not valid JSON"))
      process.exit(1)
    }

    let allPass = true

    if (body.x402Version === 1) {
      console.log(pc.green(`  x402Version: ${body.x402Version}`))
    } else {
      console.error(
        pc.red(`  x402Version: expected 1, got ${body.x402Version}`),
      )
      allPass = false
    }

    if (body.accepts && body.accepts.length > 0) {
      const req = body.accepts[0]
      const operatorAddr = options.operatorAddress as string
      if (req.payTo?.toLowerCase() === operatorAddr.toLowerCase()) {
        console.log(
          pc.green(`  payTo: ${req.payTo} (matches --operator-address)`),
        )
      } else {
        console.error(
          pc.red(`  payTo: ${req.payTo} (expected ${operatorAddr})`),
        )
        allPass = false
      }
      console.log(pc.green(`  maxAmountRequired: ${req.maxAmountRequired}`))
    } else {
      console.error(pc.red("  accepts: MISSING or empty"))
      allPass = false
    }

    if (body.error) {
      console.log(pc.green(`  error: ${JSON.stringify(body.error)}`))
    }

    if (allPass) {
      console.log(pc.green("\nAll checks passed."))
    } else {
      console.error(pc.red("\nSome checks failed."))
      process.exit(1)
    }
  })
