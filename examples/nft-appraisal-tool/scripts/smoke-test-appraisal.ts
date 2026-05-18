/**
 * Level 2 smoke test: drive the appraisal pipeline end-to-end against a real
 * NFT, bypassing the x402 gate and the Web Request/Response wrapper.
 *
 * Run:
 *   pnpm tsx scripts/smoke-test-appraisal.ts
 *   pnpm tsx scripts/smoke-test-appraisal.ts ethereum 0x... 1234
 *
 * Env (loaded from .env.local automatically if present):
 *   OPENSEA_API_KEY         required
 *   ANTHROPIC_API_KEY       required (or AI_GATEWAY_API_KEY for gateway routing)
 *   ANTHROPIC_MODEL         optional, defaults to claude-sonnet-4-6
 *
 * Defaults to Bored Ape #1 on Ethereum if no CLI args are given.
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function loadDotEnvLocal() {
  const path = resolve(process.cwd(), ".env.local")
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "")
    if (!(key in process.env)) process.env[key] = val
  }
}

loadDotEnvLocal()

if (!process.env.OPENSEA_API_KEY) {
  console.error(
    "Missing OPENSEA_API_KEY. Add it to .env.local or export it before running.",
  )
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY. Add it to .env.local or export it before running.",
  )
  process.exit(1)
}

const [chain = "ethereum", contractAddress, tokenId] = process.argv.slice(2)
const target = {
  chain,
  contractAddress:
    contractAddress ?? "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
  tokenId: tokenId ?? "1",
}

console.log(
  `Appraising ${target.chain} ${target.contractAddress} #${target.tokenId}...\n`,
)

// Initialize the module-level holders that the Workers fetch handler would
// otherwise populate from the env binding. The smoke test runs in Node, so
// it's our job to thread these through.
const { setOpenseaApiKey } = await import("../src/opensea.js")
const { runAppraisal, setAnthropicConfig } = await import("../src/appraisal.js")

setOpenseaApiKey(process.env.OPENSEA_API_KEY)
setAnthropicConfig({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL,
})

const startedAt = Date.now()
try {
  const result = await runAppraisal(target)
  const elapsedMs = Date.now() - startedAt

  console.log(JSON.stringify(result, null, 2))
  console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s`)

  // Sanity checks
  const checks: [string, boolean][] = [
    [
      "low.usd <= mid.usd <= high.usd",
      result.low.usd <= result.mid.usd && result.mid.usd <= result.high.usd,
    ],
    ["mid.amount is non-empty", result.mid.amount.length > 0],
    ["reasoning is non-trivial", result.reasoning.length >= 20],
    ["recentSales length is 0..5", result.recentSales.length <= 5],
    [
      "comparableListings length is 0..5",
      result.comparableListings.length <= 5,
    ],
    [
      "no fabricated soldAt sentinels",
      result.recentSales.every(s => !s.soldAt.includes("UNKNOWN")),
    ],
  ]
  console.log("\n--- sanity checks ---")
  for (const [label, ok] of checks) {
    console.log(ok ? "✓" : "✗", label)
    if (!ok) process.exitCode = 1
  }
} catch (err) {
  const elapsedMs = Date.now() - startedAt
  console.error(
    `\nFailed after ${(elapsedMs / 1000).toFixed(1)}s:`,
    err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  )
  process.exit(1)
}
