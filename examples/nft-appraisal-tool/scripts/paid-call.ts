/**
 * Tier 3 smoke test: real x402 paid call against the deployed tool.
 *
 * Hand-rolls the EIP-3009 transferWithAuthorization signing instead of
 * using x402-fetch — that package's transitive deps don't pass our Socket
 * Firewall policy. viem covers everything we need.
 *
 * Run:
 *   TEST_WALLET_PRIVATE_KEY=0x... pnpm tsx scripts/paid-call.ts
 *   TEST_WALLET_PRIVATE_KEY=0x... pnpm tsx scripts/paid-call.ts ethereum 0x... 4707
 *
 * Env (loaded from .env.local automatically if present):
 *   TEST_WALLET_PRIVATE_KEY    required — payer's private key (USDC on Base)
 *   TOOL_URL                   optional — POST endpoint, defaults to prod alias
 *
 * Defaults to mfers #4707 on Ethereum (the same target we used through the
 * Level-2 smoke tests, so output is comparable).
 */

import { randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { toHex } from "viem"
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

const privateKey = process.env.TEST_WALLET_PRIVATE_KEY
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error(
    "Missing or malformed TEST_WALLET_PRIVATE_KEY. Add it to .env.local or pass inline.",
  )
  process.exit(1)
}

const toolUrl =
  process.env.TOOL_URL ?? "https://nft-appraisal-tool.vercel.app/api"
const [chain = "ethereum", contractAddress, tokenId] = process.argv.slice(2)
const target = {
  chain,
  contractAddress:
    contractAddress ?? "0x79fcdef22feed20eddacbb2587640e45491b757f",
  tokenId: tokenId ?? "4707",
}

const account = privateKeyToAccount(privateKey as `0x${string}`)
console.log(`Payer: ${account.address}`)
console.log(
  `Target: ${target.chain} ${target.contractAddress} #${target.tokenId}`,
)
console.log(`Endpoint: ${toolUrl}`)

// Step 1: probe to get PaymentRequirements
console.log("\n--- step 1: probing for PaymentRequirements ---")
const probeRes = await fetch(toolUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(target),
})
if (probeRes.status !== 402) {
  console.error(
    `Expected 402, got ${probeRes.status}: ${await probeRes.text().catch(() => "<no body>")}`,
  )
  process.exit(1)
}
const probeBody = (await probeRes.json()) as {
  accepts: Array<{
    scheme: string
    network: string
    maxAmountRequired: string
    payTo: string
    asset: string
    extra?: { name?: string; version?: string }
  }>
}
const requirements = probeBody.accepts[0]
if (!requirements) {
  console.error("402 response missing accepts[0]")
  process.exit(1)
}
console.log(
  `Pay ${requirements.maxAmountRequired} (base units) of ${requirements.asset} → ${requirements.payTo}`,
)

// Step 2: sign EIP-3009 transferWithAuthorization for USDC on Base
console.log("\n--- step 2: signing EIP-3009 transferWithAuthorization ---")
const validAfter = "0"
const validBefore = String(Math.floor(Date.now() / 1000) + 600) // 10 min
const nonce = toHex(randomBytes(32))

const authorization = {
  from: account.address,
  to: requirements.payTo as `0x${string}`,
  value: requirements.maxAmountRequired,
  validAfter,
  validBefore,
  nonce,
} as const

const signature = await account.signTypedData({
  domain: {
    name: requirements.extra?.name ?? "USD Coin",
    version: requirements.extra?.version ?? "2",
    chainId: 8453,
    verifyingContract: requirements.asset as `0x${string}`,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    ...authorization,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
  },
})

const paymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: { signature, authorization },
}
const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64")
console.log(`Signed. X-Payment header: ${xPayment.length} chars (base64)`)

// Step 3: replay the request with the signed payment
console.log("\n--- step 3: paid request ---")
const startedAt = Date.now()
const paidRes = await fetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Payment": xPayment,
  },
  body: JSON.stringify(target),
})
const elapsedMs = Date.now() - startedAt
console.log(`Status: ${paidRes.status} (${(elapsedMs / 1000).toFixed(1)}s)`)

const body = (await paidRes.json()) as unknown
console.log(JSON.stringify(body, null, 2))

if (paidRes.status === 200) {
  console.log("\n✓ Paid call succeeded — appraisal returned.")
} else if (paidRes.status === 402) {
  console.error(
    "\n✗ 402 after signed payment — facilitator rejected the proof. Check the signing logic + nonce.",
  )
  process.exit(1)
} else {
  console.error(
    `\n✗ Unexpected status ${paidRes.status}. Check function logs for stack trace.`,
  )
  process.exit(1)
}

// Step 4: confirm the SDK gate auto-settled.
//
// History: dogfood finding #25 originally observed that the SDK's x402
// gate called /verify but never /settle, so paid calls succeeded but
// USDC never moved. opensea-devtools PR #171 fixed this — the gate now
// settles after the handler succeeds and the output validates.
//
// Test logic: try to settle the same payment manually after step 3.
// With the fixed SDK, step 3 already consumed the nonce, so this
// manual settle MUST fail with a duplicate-nonce error. A 200 here
// would mean the gate didn't settle in step 3 — that's a regression
// and we fail the script.
console.log("\n--- step 4: confirm SDK gate settled in step 3 ---")
const facilitatorUrl = "https://facilitator.payai.network"
const settleRes = await fetch(`${facilitatorUrl}/settle`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    x402Version: 1,
    paymentPayload,
    paymentRequirements: requirements,
  }),
})
const settleBodyText = await settleRes.text()
console.log(`Manual /settle status: ${settleRes.status}`)
console.log(settleBodyText)

const isDuplicate =
  settleRes.status >= 400 &&
  /duplicate|already|consumed|nonce/i.test(settleBodyText)

if (isDuplicate) {
  console.log(
    "\n✓ Manual /settle correctly rejected — the gate consumed the nonce in step 3.",
  )
  console.log(
    `  Verify USDC moved on chain: https://basescan.org/address/${requirements.payTo}#tokentxns`,
  )
} else if (settleRes.status === 200) {
  console.error(
    "\n✗ Manual /settle succeeded — the SDK gate did NOT settle in step 3.",
  )
  console.error(
    "  This is dogfood finding #25 territory. Check `npx vercel logs` for [tool-sdk]",
  )
  console.error(
    "  errors, and confirm the deployed bundle has the new GateMiddleware.settle hook.",
  )
  process.exit(1)
} else {
  console.error(
    `\n✗ Unexpected /settle status ${settleRes.status}. PayAI may be having issues.`,
  )
  process.exit(1)
}
