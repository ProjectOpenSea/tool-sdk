import { Command } from "commander"
import pc from "picocolors"
import { type Address, getAddress } from "viem"
import {
  deploymentAddress,
  ERC721_OWNER_PREDICATE,
} from "../../lib/onchain/chains.js"
import { ERC721OwnerPredicateClient } from "../../lib/onchain/predicate-clients.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletProvider,
  walletAdapterToClient,
} from "../../lib/wallet/index.js"
import { getChain } from "./get-chain.js"

interface SetCollectionsOptions {
  network: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
}

export const setCollectionsCommand = new Command("set-collections")
  .description(
    "Set the ERC-721 collection gate list for an already-registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .argument("<addresses...>", "Collection addresses to gate on")
  .option("--network <network>", "Network: base or mainnet", "base")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option("--rpc-url <url>", "RPC endpoint")
  .option("--dry-run", "Print encoded calldata without transacting")
  .action(
    async (
      toolIdRaw: string,
      addresses: string[],
      options: SetCollectionsOptions,
    ) => {
      let toolId: bigint
      try {
        toolId = BigInt(toolIdRaw)
      } catch {
        console.error(pc.red("Error: toolId must be a valid integer"))
        process.exit(1)
        return
      }
      const chain = getChain(options.network)

      let collections: Address[]
      try {
        collections = addresses.map(a => getAddress(a))
      } catch {
        console.error(pc.red("Error: invalid collection address"))
        process.exit(1)
      }

      const predicateAddr = deploymentAddress(ERC721_OWNER_PREDICATE, chain.id)
      if (!predicateAddr) {
        console.error(
          pc.red(
            `Error: ERC721OwnerPredicate is not deployed on ${options.network}.`,
          ),
        )
        process.exit(1)
      }

      console.log(pc.bold("Set Collections"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  Network: ${options.network}`)
      console.log(`  Predicate: ${predicateAddr} (ERC721OwnerPredicate)`)
      console.log(`  Collections: ${collections.join(", ")}`)

      if (options.dryRun) {
        console.log(pc.yellow("\n[dry-run] No transaction sent."))
        return
      }

      const adapter = options.walletProvider
        ? await createWalletForProvider(
            options.walletProvider as WalletProvider,
          )
        : await createWalletFromEnv()

      const walletClient = await walletAdapterToClient(
        adapter,
        chain,
        options.rpcUrl,
      )

      const client = new ERC721OwnerPredicateClient({
        chain,
        walletClient,
        predicateAddress: predicateAddr,
        rpcUrl: options.rpcUrl,
      })

      try {
        const txHash = await client.setCollections(toolId, collections)
        console.log(pc.green("\nCollections updated!"))
        console.log(`  TX Hash: ${txHash}`)
      } catch (err) {
        console.error(pc.red("Error setting collections:"))
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )
