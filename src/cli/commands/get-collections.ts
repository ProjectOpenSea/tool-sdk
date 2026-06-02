import { Command } from "commander"
import pc from "picocolors"
import { zeroAddress } from "viem"
import {
  deploymentAddress,
  ERC721_OWNER_PREDICATE,
} from "../../lib/onchain/chains.js"
import { ERC721OwnerPredicateClient } from "../../lib/onchain/predicate-clients.js"
import { ToolRegistryClient } from "../../lib/onchain/registry.js"
import { getChain } from "./get-chain.js"

interface GetCollectionsOptions {
  network: string
  rpcUrl?: string
}

export const getCollectionsCommand = new Command("get-collections")
  .description("Read the ERC-721 collection gate list for a registered tool")
  .argument("<toolId>", "Tool ID (uint256)")
  .option(
    "--network <network>",
    "Network: base, mainnet, shape, or abstract",
    "base",
  )
  .option("--rpc-url <url>", "RPC endpoint")
  .action(async (toolIdRaw: string, options: GetCollectionsOptions) => {
    let toolId: bigint
    try {
      toolId = BigInt(toolIdRaw)
    } catch {
      console.error(pc.red("Error: toolId must be a valid integer"))
      process.exit(1)
      return
    }
    const chain = getChain(options.network)

    const registry = new ToolRegistryClient({
      chain,
      rpcUrl: options.rpcUrl,
    })

    const toolConfig = await registry.getToolConfig(toolId)
    if (toolConfig.accessPredicate === zeroAddress) {
      console.log(
        pc.yellow(`Tool ${toolId} has open access (no predicate set).`),
      )
      return
    }

    const predicateAddr = deploymentAddress(ERC721_OWNER_PREDICATE, chain.id)

    if (
      predicateAddr &&
      toolConfig.accessPredicate.toLowerCase() === predicateAddr.toLowerCase()
    ) {
      const client = new ERC721OwnerPredicateClient({
        chain,
        predicateAddress: predicateAddr,
        rpcUrl: options.rpcUrl,
      })

      const collections = await client.getCollections(toolId)
      console.log(pc.bold(`Collections for tool ${toolId}:`))
      console.log(`  Predicate: ${predicateAddr} (ERC721OwnerPredicate)`)
      if (collections.length === 0) {
        console.log(
          pc.yellow("  No collections configured (gate accepts no one)."),
        )
      } else {
        for (const addr of collections) {
          console.log(`  - ${addr}`)
        }
      }
    } else {
      console.log(
        pc.yellow(
          `Tool ${toolId} uses predicate ${toolConfig.accessPredicate} (not the canonical ERC721OwnerPredicate).`,
        ),
      )
      console.log(
        "  Use a tool-specific command or cast to inspect this predicate.",
      )
    }
  })
