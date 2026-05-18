/**
 * Smoke test: confirm the handler returns a x402-compliant 402 when
 * X-Payment is missing. Doesn't hit OpenSea or the LLM — the gate runs
 * before the handler body, so we never need real API keys for this check.
 *
 * Run:
 *   pnpm tsx scripts/smoke-test-402.ts
 */

export {} // mark as ESM so top-level await is allowed

// SDK 0.6+ enforces lowercase EVM addresses on resolve.
const CREATOR = "0x1234567890abcdefabcdef1234567890abcdefab" as const
const RECIPIENT = "0xc0de0000000000000000000000000000000000de" as const

const { buildPublicManifest } = await import("../src/manifest.js")
const { buildToolHandler } = await import("../src/handler.js")
const { buildPublicPaywall } = await import("../src/paywall.js")

const paywall = buildPublicPaywall({ recipient: RECIPIENT })
const manifest = buildPublicManifest({
  creator: CREATOR,
  endpoint: "https://local.test/api",
  pricing: paywall.pricing,
})
const toolHandler = buildToolHandler({ manifest, gates: [paywall.gate] })

async function expectStatus(req: Request, status: number, label: string) {
  const res = await toolHandler(req)
  const body = await res.json()
  const ok = res.status === status
  console.log(
    ok ? "✓" : "✗",
    label,
    `→ ${res.status}`,
    JSON.stringify(body).slice(0, 200),
  )
  if (!ok) process.exitCode = 1
  return body
}

const validInput = JSON.stringify({
  chain: "base",
  contractAddress: "0x000000000000000000000000000000000000dEaD",
  tokenId: "1",
})

console.log("\n--- 402 paths (gate runs before handler body) ---")

const noPaymentBody = await expectStatus(
  new Request("https://local.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: validInput,
  }),
  402,
  "no X-Payment header",
)

console.log("\n--- 402 body shape ---")
console.log(JSON.stringify(noPaymentBody, null, 2))

const requirements = (noPaymentBody as { accepts?: unknown[] }).accepts?.[0] as
  | Record<string, unknown>
  | undefined
const checks: [string, boolean][] = [
  ["accepts[0] exists", !!requirements],
  ["scheme === 'exact'", requirements?.scheme === "exact"],
  ["network === 'base'", requirements?.network === "base"],
  [
    "maxAmountRequired === '50000' (0.05 USDC)",
    requirements?.maxAmountRequired === "50000",
  ],
  [
    "asset is USDC on Base",
    requirements?.asset === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  ],
  ["payTo is RECIPIENT", requirements?.payTo === RECIPIENT],
]
for (const [label, ok] of checks) {
  console.log(ok ? "✓" : "✗", label)
  if (!ok) process.exitCode = 1
}

console.log("\n--- malformed X-Payment ---")

await expectStatus(
  new Request("https://local.test/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment": "not-base64-encoded-json",
    },
    body: validInput,
  }),
  402,
  "garbage X-Payment",
)
