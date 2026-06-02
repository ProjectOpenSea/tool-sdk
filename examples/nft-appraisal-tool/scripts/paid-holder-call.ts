/**
 * Tier 3 smoke for the holder tier: EIP-3009-authenticated + x402-paid call
 * against /api/holder. Uses the SDK's `paidAuthenticatedFetch`, which:
 *
 *   1. Signs a zero-value EIP-3009 TransferWithAuthorization
 *   2. POSTs with `Authorization: EIP-3009 <token>`
 *   3. On 402, signs an EIP-3009 transferWithAuthorization for payment
 *   4. Replays with `Authorization` + `X-Payment` headers
 *   5. Returns the final response
 *
 * The wallet must hold a CHONK on Base — `predicateGate` rejects with 403
 * before payment if the onchain predicate's `tryHasAccess(toolId, caller)`
 * returns false.
 *
 * Run:
 *   PRIVATE_KEY=0x... pnpm tsx scripts/paid-holder-call.ts
 *   PRIVATE_KEY=0x... pnpm tsx scripts/paid-holder-call.ts ethereum 0x... 4707
 *
 * Env (loaded from .env.local automatically if present):
 *   PRIVATE_KEY         required — CHONK-holder wallet's private key (also pays $0.01 USDC)
 *   RECIPIENT_ADDRESS   required — 0x-prefixed payout address to allowlist
 *   TOOL_URL            optional — POST endpoint, defaults to prod /api/holder alias
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { paidAuthenticatedFetch } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

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

const privateKey = process.env.PRIVATE_KEY
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error(
    "Missing or malformed PRIVATE_KEY. Add it to .env.local or pass inline.",
  )
  process.exit(1)
}

const recipientAddress = process.env.RECIPIENT_ADDRESS
if (!recipientAddress || !/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
  console.error(
    "Missing or malformed RECIPIENT_ADDRESS. Add it to .env.local or pass inline.",
  )
  process.exit(1)
}

const toolUrl =
  process.env.TOOL_URL ?? "https://nft-appraisal-tool.vercel.app/api/holder"
const [chain = "ethereum", contractAddress, tokenId] = process.argv.slice(2)
const target = {
  chain,
  contractAddress:
    contractAddress ?? "0x79fcdef22feed20eddacbb2587640e45491b757f",
  tokenId: tokenId ?? "4707",
}

const account = privateKeyToAccount(privateKey as `0x${string}`)
console.log(`Caller: ${account.address}`)
console.log(
  `Target: ${target.chain} ${target.contractAddress} #${target.tokenId}`,
)
console.log(`Endpoint: ${toolUrl}`)

console.log("\n--- paidAuthenticatedFetch (EIP-3009 + x402) ---")
const startedAt = Date.now()
const res = await paidAuthenticatedFetch(toolUrl, {
  account,
  chainId: 8453,
  // Reject if the server asks for more than 0.01 USDC (the holder rate).
  // Prevents a compromised server from inflating the price.
  maxAmount: "10000",
  allowedRecipients: [recipientAddress],
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(target),
})
const elapsedMs = Date.now() - startedAt
console.log(`Status: ${res.status} (${(elapsedMs / 1000).toFixed(1)}s)`)

const body = (await res.json()) as unknown
console.log(JSON.stringify(body, null, 2))

if (res.status === 200) {
  console.log("\n✓ Holder paid call succeeded — appraisal returned.")
  console.log(
    `  Verify USDC moved on chain: https://basescan.org/address/${recipientAddress}#tokentxns`,
  )
} else if (res.status === 401) {
  console.error(
    "\n✗ 401 — EIP-3009 auth failed. paidAuthenticatedFetch should have signed; check chainId / account.",
  )
  process.exit(1)
} else if (res.status === 403) {
  console.error(
    `\n✗ 403 — predicate denied access. Wallet ${account.address} doesn't hold a CHONK on Base, or the predicate is misconfigured for toolId.`,
  )
  process.exit(1)
} else if (res.status === 402) {
  console.error(
    "\n✗ 402 after paidAuthenticatedFetch — payment proof rejected by facilitator.",
  )
  process.exit(1)
} else {
  console.error(`\n✗ Unexpected status ${res.status}. Check Vercel logs.`)
  process.exit(1)
}
