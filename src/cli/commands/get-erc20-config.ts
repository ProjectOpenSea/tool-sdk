import { Command } from "commander"
import pc from "picocolors"
import { type Address, getAddress } from "viem"
import {
  deploymentAddress,
  ERC20_BALANCE_PREDICATE,
} from "../../lib/onchain/chains.js"
import { ERC20BalancePredicateClient } from "../../lib/onchain/predicate-clients.js"
import { getChain, NETWORK_OPTION_DESCRIPTION } from "./get-chain.js"
import { parseToolId } from "./shared.js"

interface GetERC20ConfigOptions {
  network: string
  predicateAddress?: string
  rpcUrl?: string
}

export const getERC20ConfigCommand = new Command("get-erc20-config")
  .description(
    "Read the ERC-20 balance gating configuration for a registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .option(
    "--predicate-address <address>",
    "Override the canonical ERC20BalancePredicate address",
  )
  .option("--network <network>", NETWORK_OPTION_DESCRIPTION, "base")
  .option("--rpc-url <url>", "RPC endpoint")
  .action(async (toolIdRaw: string, options: GetERC20ConfigOptions) => {
    const toolId = parseToolId(toolIdRaw)

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
      const canonical = deploymentAddress(ERC20_BALANCE_PREDICATE, chain.id)
      if (!canonical) {
        console.error(
          pc.red(
            `Error: ERC20BalancePredicate has no canonical deployment on ${options.network}. Pass --predicate-address.`,
          ),
        )
        process.exit(1)
        return
      }
      predicateAddress = canonical
    }

    const client = new ERC20BalancePredicateClient({
      chain,
      predicateAddress,
      rpcUrl: options.rpcUrl,
    })

    const config = await client.getToolERC20Config(toolId)

    if (config.token === "0x0000000000000000000000000000000000000000") {
      console.log(
        pc.yellow(`Tool ${toolId} has no ERC-20 balance gate configured.`),
      )
      return
    }

    console.log(pc.bold(`ERC-20 balance gate config for tool ${toolId}:`))
    console.log(`  Predicate: ${predicateAddress} (ERC20BalancePredicate)`)
    console.log(`  Token: ${config.token}`)
    console.log(`  Min Balance: ${config.minBalance}`)
  })
