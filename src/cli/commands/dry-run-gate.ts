import { Command } from "commander"
import pc from "picocolors"
import { z } from "zod/v4"
import { createToolHandler } from "../../lib/handler/index.js"
import { validateManifest } from "../../lib/manifest/index.js"
import { defineToolPaywall } from "../../lib/middleware/x402-facilitators.js"
import { loadManifest } from "./load-manifest.js"
import { readInput } from "./read-input.js"

interface DryRunGateOptions {
  manifest: string
  input?: string
}

export const dryRunGateCommand = new Command("dry-run-gate")
  .description(
    "Invoke a tool handler locally with no X-Payment header and assert a valid 402 response",
  )
  .option("--manifest <path>", "Path to manifest .ts or .json file (required)")
  .option("--input <json>", "JSON input body (inline or @path)")
  .action(async (options: DryRunGateOptions) => {
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

    if (!manifest.pricing || manifest.pricing.length === 0) {
      console.error(
        pc.red("Error: Manifest has no pricing entries; nothing to gate"),
      )
      process.exit(1)
    }

    const recipient = manifest.pricing[0].recipient
    const recipientMatch = recipient.match(/:(0x[0-9a-fA-F]{40})$/)
    if (!recipientMatch) {
      console.error(
        pc.red("Error: Could not extract recipient address from pricing"),
      )
      process.exit(1)
    }
    const recipientAddress = recipientMatch[1] as `0x${string}`

    const amountUsdc = manifest.pricing[0].amount

    console.log(pc.cyan("Building paywall gate..."))
    const { gate } = defineToolPaywall({
      recipient: recipientAddress,
      amountUsdc,
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
      accepts?: Array<{
        scheme?: string
        network?: string
        maxAmountRequired?: string
        payTo?: string
        asset?: string
      }>
    }
    try {
      body = (await res.json()) as typeof body
    } catch {
      console.error(pc.red("FAIL: 402 response body is not valid JSON"))
      process.exit(1)
    }

    const accepts = body.accepts?.[0]
    if (!accepts) {
      console.error(pc.red("FAIL: 402 response missing accepts[0]"))
      process.exit(1)
    }

    const checks = [
      { field: "scheme", value: accepts.scheme },
      { field: "network", value: accepts.network },
      { field: "maxAmountRequired", value: accepts.maxAmountRequired },
      { field: "payTo", value: accepts.payTo },
      { field: "asset", value: accepts.asset },
    ]

    let allPass = true
    for (const check of checks) {
      if (check.value) {
        console.log(pc.green(`  ${check.field}: ${check.value}`))
      } else {
        console.error(pc.red(`  ${check.field}: MISSING`))
        allPass = false
      }
    }

    if (allPass) {
      console.log(pc.green("\nAll checks passed."))
    } else {
      console.error(pc.red("\nSome checks failed."))
      process.exit(1)
    }
  })
