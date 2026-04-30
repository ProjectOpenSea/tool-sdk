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
  input?: string
}

export const dryRunPredicateGateCommand = new Command("dry-run-predicate-gate")
  .description(
    "Invoke a tool handler locally with no SIWE auth header and assert a valid 401 response",
  )
  .option("--manifest <path>", "Path to manifest .ts or .json file (required)")
  .option("--tool-id <id>", "Onchain tool ID to configure in the gate")
  .option("--input <json>", "JSON input body (inline or @path)")
  .action(async (options: DryRunPredicateGateOptions) => {
    if (!options.manifest) {
      console.error(pc.red("Error: --manifest is required"))
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
    const gate = predicateGate({ toolId })

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

    console.log(pc.cyan("Invoking handler with no Authorization header...\n"))

    const request = new Request(manifest.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputBody,
    })

    const res = await handler(request)

    if (res.status !== 401) {
      console.error(pc.red(`FAIL: Expected status 401, got ${res.status}`))
      const text = await res.text()
      if (text) console.error(pc.dim(text))
      process.exit(1)
    }

    console.log(pc.green("Status: 401 (correct)"))

    let body: { error?: string; hint?: string }
    try {
      body = (await res.json()) as typeof body
    } catch {
      console.error(pc.red("FAIL: 401 response body is not valid JSON"))
      process.exit(1)
    }

    let allPass = true

    if (body.error) {
      console.log(pc.green(`  error: ${JSON.stringify(body.error)}`))
    } else {
      console.error(pc.red("  error: MISSING"))
      allPass = false
    }

    if (body.hint && /SIWE/i.test(body.hint)) {
      console.log(pc.green(`  hint: ${JSON.stringify(body.hint)}`))
    } else if (body.hint) {
      console.error(pc.red(`  hint: present but does not mention SIWE`))
      allPass = false
    } else {
      console.error(pc.red("  hint: MISSING"))
      allPass = false
    }

    if (allPass) {
      console.log(pc.green("\nAll checks passed."))
    } else {
      console.error(pc.red("\nSome checks failed."))
      process.exit(1)
    }
  })
