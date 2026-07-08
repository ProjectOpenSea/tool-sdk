import { Command } from "commander"
import pc from "picocolors"
import { type Address, fromHex, getAddress } from "viem"
import {
  deploymentAddress,
  TRAIT_GATED_PREDICATE,
} from "../../lib/onchain/chains.js"
import { TraitGatedPredicateClient } from "../../lib/onchain/predicate-clients.js"
import { getChain, NETWORK_OPTION_DESCRIPTION } from "./get-chain.js"

interface GetTraitConfigOptions {
  network: string
  predicateAddress?: string
  rpcUrl?: string
}

export const getTraitConfigCommand = new Command("get-trait-config")
  .description("Read the trait gating configuration for a registered tool")
  .argument("<toolId>", "Tool ID (uint256)")
  .option("--network <network>", NETWORK_OPTION_DESCRIPTION, "base")
  .option(
    "--predicate-address <address>",
    "Override the canonical TraitGatedPredicate address",
  )
  .option("--rpc-url <url>", "RPC endpoint")
  .action(async (toolIdRaw: string, options: GetTraitConfigOptions) => {
    let toolId: bigint
    try {
      toolId = BigInt(toolIdRaw)
    } catch {
      console.error(pc.red("Error: toolId must be a valid integer"))
      process.exit(1)
      return
    }

    const chain = getChain(options.network)

    let predicateAddress: Address
    if (options.predicateAddress) {
      try {
        predicateAddress = getAddress(options.predicateAddress)
      } catch {
        console.error(pc.red("Error: invalid --predicate-address"))
        process.exit(1)
        return
      }
    } else {
      const canonical = deploymentAddress(TRAIT_GATED_PREDICATE, chain.id)
      if (!canonical) {
        console.error(
          pc.red(
            `Error: TraitGatedPredicate has no canonical deployment on ${options.network}. Pass --predicate-address.`,
          ),
        )
        process.exit(1)
        return
      }
      predicateAddress = canonical
    }

    const client = new TraitGatedPredicateClient({
      chain,
      predicateAddress,
      rpcUrl: options.rpcUrl,
    })

    const config = await client.getToolTraitConfig(toolId)

    if (config.collection === "0x0000000000000000000000000000000000000000") {
      console.log(pc.yellow(`Tool ${toolId} has no trait gating configured.`))
      return
    }

    const traitKeyStr = fromHex(
      config.traitKey as `0x${string}`,
      "string",
    ).replace(/\0+$/, "")

    console.log(pc.bold(`Trait gating config for tool ${toolId}:`))
    console.log(`  Predicate: ${predicateAddress} (TraitGatedPredicate)`)
    console.log(`  Collection: ${config.collection}`)
    console.log(`  Traits Contract: ${config.traitsContract}`)
    console.log(`  Trait Key: "${traitKeyStr}" (${config.traitKey})`)
    console.log(`  Allowed Values:`)
    for (const v of config.allowedValues) {
      const str = fromHex(v as `0x${string}`, "string").replace(/\0+$/, "")
      console.log(`    - "${str}" (${v})`)
    }
  })
