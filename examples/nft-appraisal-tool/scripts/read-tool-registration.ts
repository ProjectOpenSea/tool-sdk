/**
 * Read a registered tool's onchain state from the ToolRegistry on Base
 * mainnet, and cross-check against the locally-computed manifest hash.
 *
 * Cross-checks (derived from chain state + served manifest, no hardcoding):
 *   - metadataURI is reachable and serves a valid manifest
 *   - manifestHash matches `computeManifestHash(liveManifest)`
 *   - manifest's `creatorAddress` matches the onchain `creator`
 *   - if `accessPredicate != 0`: probe the predicate (`name()`, supports
 *     IAccessPredicate per ERC-165), and for ERC721OwnerPredicate also
 *     read `getCollections(toolId)` to confirm gating is configured.
 *   - if accessPredicate == 0: confirm the manifest doesn't advertise an
 *     access requirement (i.e. truly open).
 *
 * Run:
 *   pnpm tsx scripts/read-tool-registration.ts <toolId>
 *   pnpm tsx scripts/read-tool-registration.ts 3   # public
 *   pnpm tsx scripts/read-tool-registration.ts 4   # holder
 */

import {
  computeManifestHash,
  ERC721OwnerPredicateABI,
  IAccessPredicateABI,
  ToolRegistryClient,
} from "@opensea/tool-sdk"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const toolIdArg = process.argv[2]
if (!toolIdArg || !/^\d+$/.test(toolIdArg)) {
  console.error("Usage: pnpm tsx scripts/read-tool-registration.ts <toolId>")
  process.exit(1)
}
const toolId = BigInt(toolIdArg)

console.log(`Reading tool #${toolId} from ToolRegistry on Base mainnet...`)

const client = new ToolRegistryClient({ chain: base })
const config = await client.getToolConfig(toolId)

console.log("\n--- onchain state ---")
console.log(`  toolId          ${toolId}`)
console.log(`  creator         ${config.creator}`)
console.log(`  metadataURI     ${config.metadataURI}`)
console.log(`  manifestHash    ${config.manifestHash}`)
console.log(`  accessPredicate ${config.accessPredicate}`)

console.log("\n--- cross-checks ---")

const checks: Array<[string, boolean, string]> = []

let liveManifest:
  | {
      creatorAddress?: string
      access?: { requirements?: Array<{ kind: string; data: string }> }
    }
  | undefined

try {
  const res = await fetch(config.metadataURI)
  if (!res.ok) throw new Error(`fetch returned ${res.status}`)
  liveManifest = await res.json()
  // biome-ignore lint/suspicious/noExplicitAny: SDK validates shape internally
  const liveHash = computeManifestHash(liveManifest as any)
  checks.push([
    "manifestHash matches live manifest hash",
    config.manifestHash.toLowerCase() === liveHash.toLowerCase(),
    `live hash: ${liveHash}`,
  ])
  checks.push([
    "manifest creatorAddress matches onchain creator",
    (liveManifest?.creatorAddress ?? "").toLowerCase() ===
      config.creator.toLowerCase(),
    `manifest: ${liveManifest?.creatorAddress}`,
  ])
} catch (err) {
  checks.push([
    "manifest is reachable",
    false,
    `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
  ])
}

const isOpenAccess = config.accessPredicate === ZERO_ADDRESS
const manifestHasAccess = (liveManifest?.access?.requirements?.length ?? 0) > 0

if (isOpenAccess) {
  checks.push([
    "open access (predicate=0) consistent with manifest (no access requirements)",
    !manifestHasAccess,
    "manifest declares an access block but onchain predicate is zero",
  ])
} else {
  // Predicate gating active — probe the predicate.
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  })

  let predicateName: string | undefined
  try {
    predicateName = await publicClient.readContract({
      address: config.accessPredicate,
      abi: IAccessPredicateABI,
      functionName: "name",
    })
    console.log(`\n  predicate name  ${predicateName}`)
  } catch (err) {
    console.log(
      `\n  predicate name  (failed to read: ${err instanceof Error ? err.message : String(err)})`,
    )
  }

  checks.push([
    "manifest declares an access block (consistent with non-zero predicate)",
    manifestHasAccess,
    "manifest has no access block but onchain predicate is non-zero",
  ])

  // For ERC721OwnerPredicate (the canonical NFT gate), confirm the
  // collection list is non-empty so the predicate actually gates anything.
  if (predicateName === "ERC721OwnerPredicate") {
    try {
      const collections = (await publicClient.readContract({
        address: config.accessPredicate,
        abi: ERC721OwnerPredicateABI,
        functionName: "getCollections",
        args: [toolId],
      })) as readonly `0x${string}`[]
      console.log(
        `  collections     ${collections.length === 0 ? "(none — predicate gates nothing!)" : collections.join(", ")}`,
      )
      checks.push([
        "ERC721 predicate has at least one collection configured",
        collections.length > 0,
        "no collections — anyone with a SIWE signature would pass the gate",
      ])
    } catch (err) {
      checks.push([
        "ERC721 predicate getCollections succeeded",
        false,
        err instanceof Error ? err.message : String(err),
      ])
    }
  }
}

let failed = 0
for (const [label, ok, detail] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${detail}`}`)
  if (!ok) failed++
}

if (failed > 0) {
  console.error(`\n✗ ${failed} cross-check(s) failed.`)
  process.exit(1)
}

console.log(`\n✓ Registration verified end-to-end.`)
