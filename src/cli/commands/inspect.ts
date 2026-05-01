import { Command } from "commander"
import pc from "picocolors"
import {
  type Address,
  createPublicClient,
  http,
  isAddress,
  zeroAddress,
} from "viem"
import { validateManifest } from "../../lib/manifest/index.js"
import {
  CompositePredicateABI,
  ERC721OwnerPredicateABI,
  ERC1155OwnerPredicateABI,
  IAccessPredicateABI,
  SubscriptionPredicateABI,
} from "../../lib/onchain/abis.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"
import { ToolRegistryClient } from "../../lib/onchain/registry.js"
import { getChain } from "./get-chain.js"

interface InspectOptions {
  toolId: string
  network: string
  checkAccess?: string
}

export const inspectCommand = new Command("inspect")
  .description(
    "Read onchain tool state and cross-check against the live manifest",
  )
  .option("--tool-id <id>", "Numeric tool ID (required)")
  .option("--network <network>", "Network: base or mainnet", "base")
  .option(
    "--check-access <address>",
    "Check whether an address has access to the tool",
  )
  .action(async (options: InspectOptions) => {
    if (!options.toolId) {
      console.error(pc.red("Error: --tool-id is required"))
      process.exit(1)
    }

    let toolId: bigint
    try {
      toolId = BigInt(options.toolId)
    } catch {
      console.error(pc.red("Error: --tool-id must be a numeric value"))
      process.exit(1)
    }

    const chain = getChain(options.network)
    const client = new ToolRegistryClient({ chain })

    console.log(pc.cyan("Reading onchain tool config...\n"))

    let config: Awaited<ReturnType<ToolRegistryClient["getToolConfig"]>>
    try {
      config = await client.getToolConfig(toolId)
    } catch (err) {
      console.error(pc.red("Error: Failed to read tool config"))
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    console.log(pc.cyan("Onchain data:"))
    console.log(`  Creator:          ${config.creator}`)
    console.log(`  Metadata URI:     ${config.metadataURI}`)
    console.log(`  Manifest Hash:    ${config.manifestHash}`)
    console.log(`  Access Predicate: ${config.accessPredicate}`)

    if (config.accessPredicate !== zeroAddress) {
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      })

      let predicateName: string | undefined
      try {
        predicateName = await publicClient.readContract({
          address: config.accessPredicate,
          abi: IAccessPredicateABI,
          functionName: "name",
        })
      } catch {
        // predicate may not implement name()
      }

      console.log(`  Predicate name:   ${predicateName ?? "<unknown>"}`)

      if (predicateName === "ERC721OwnerPredicate") {
        try {
          const collections = await publicClient.readContract({
            address: config.accessPredicate,
            abi: ERC721OwnerPredicateABI,
            functionName: "getCollections",
            args: [toolId],
          })
          console.log("  Collections:")
          for (let i = 0; i < collections.length; i++) {
            console.log(`    [${i}] ${collections[i]}`)
          }
        } catch (err) {
          console.error(
            pc.yellow(
              `  Warning: Failed to read collections: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      } else if (predicateName === "ERC1155OwnerPredicate") {
        try {
          const entries = await publicClient.readContract({
            address: config.accessPredicate,
            abi: ERC1155OwnerPredicateABI,
            functionName: "getCollectionTokens",
            args: [toolId],
          })
          console.log("  Collection tokens:")
          for (let i = 0; i < entries.length; i++) {
            console.log(`    [${i}] ${entries[i].collection}`)
            console.log(
              `        Token IDs: ${entries[i].tokenIds.map(String).join(", ")}`,
            )
          }
        } catch (err) {
          console.error(
            pc.yellow(
              `  Warning: Failed to read collection tokens: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      } else if (predicateName === "SubscriptionPredicate") {
        try {
          const gatingConfig = await publicClient.readContract({
            address: config.accessPredicate,
            abi: SubscriptionPredicateABI,
            functionName: "getToolGatingConfig",
            args: [toolId],
          })
          console.log(`  Subscription collection: ${gatingConfig.collection}`)
          console.log(
            `  Min tier: ${gatingConfig.minTier === 0 ? "any active subscription" : gatingConfig.minTier}`,
          )
        } catch (err) {
          console.error(
            pc.yellow(
              `  Warning: Failed to read subscription config: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      } else if (predicateName === "CompositePredicate") {
        try {
          const [op, terms] = await Promise.all([
            publicClient.readContract({
              address: config.accessPredicate,
              abi: CompositePredicateABI,
              functionName: "getOp",
              args: [toolId],
            }),
            publicClient.readContract({
              address: config.accessPredicate,
              abi: CompositePredicateABI,
              functionName: "getTerms",
              args: [toolId],
            }),
          ])
          console.log(`  Composite op: ${op === 0 ? "ALL (AND)" : "ANY (OR)"}`)
          console.log(`  Terms (${terms.length}):`)
          for (let i = 0; i < terms.length; i++) {
            const negStr = terms[i].negate ? " (negated)" : ""
            console.log(`    [${i}] ${terms[i].predicate}${negStr}`)
          }
        } catch (err) {
          console.error(
            pc.yellow(
              `  Warning: Failed to read composite config: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      } else {
        // Unknown predicate — show advisory getRequirements output
        try {
          const [requirements, logic] = await publicClient.readContract({
            address: config.accessPredicate,
            abi: IAccessPredicateABI,
            functionName: "getRequirements",
            args: [toolId],
          })
          if (requirements.length > 0) {
            console.log(
              pc.cyan(
                `\n  Access requirements (${logic === 0 ? "AND" : "OR"}, advisory):`,
              ),
            )
            for (let i = 0; i < requirements.length; i++) {
              const r = requirements[i]
              const label = r.label || "<no label>"
              console.log(`    [${i}] kind: ${r.kind}  label: ${label}`)
              if (r.data !== "0x") {
                console.log(`         data: ${r.data}`)
              }
            }
          }
        } catch {
          // predicate may not implement getRequirements
        }
      }
    }

    if (options.checkAccess) {
      if (!isAddress(options.checkAccess)) {
        console.error(
          pc.red("Error: --check-access must be a valid Ethereum address"),
        )
        process.exit(1)
      }
      const address: Address = options.checkAccess
      console.log(pc.cyan(`\nAccess check for ${address}:`))
      try {
        const { ok, granted } = await client.tryHasAccess(toolId, address, "0x")
        console.log(
          `  ok: ${ok} (${ok ? "predicate responded normally" : "predicate misbehaved"})`,
        )
        console.log(`  granted: ${granted}`)
      } catch (err) {
        console.error(
          pc.red(
            `  Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      }
    }

    console.log(pc.cyan("\nFetching manifest from metadata URI..."))

    let response: globalThis.Response
    try {
      response = await fetch(config.metadataURI, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      console.error(pc.red(`Error: Failed to fetch ${config.metadataURI}`))
      process.exit(1)
    }

    if (response.status !== 200) {
      console.error(
        pc.red(`FAIL: Metadata URI returned HTTP ${response.status}`),
      )
      process.exit(1)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      console.error(pc.red("FAIL: Response is not valid JSON"))
      process.exit(1)
    }

    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("\nManifest validation: FAIL"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    const manifest = result.data
    console.log(pc.green("\nManifest validation: PASS"))
    console.log(`  Name: ${manifest.name}`)
    console.log(`  Endpoint: ${manifest.endpoint}`)

    const computedHash = computeManifestHash(manifest)
    console.log(pc.cyan("\nHash cross-check:"))
    console.log(`  Onchain:   ${config.manifestHash}`)
    console.log(`  Computed:  ${computedHash}`)

    if (computedHash === config.manifestHash) {
      console.log(pc.green("  Result:    MATCH"))
    } else {
      console.error(pc.red("  Result:    MISMATCH"))
      process.exit(1)
    }
  })
