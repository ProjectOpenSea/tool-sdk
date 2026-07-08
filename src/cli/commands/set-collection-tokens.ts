import { Command } from "commander"
import pc from "picocolors"
import { type Address, getAddress } from "viem"
import {
  deploymentAddress,
  ERC1155_OWNER_PREDICATE,
} from "../../lib/onchain/chains.js"
import { ERC1155OwnerPredicateClient } from "../../lib/onchain/predicate-clients.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletProvider,
  walletAdapterToClient,
} from "../../lib/wallet/index.js"
import { getChain, NETWORK_OPTION_DESCRIPTION } from "./get-chain.js"

interface SetCollectionTokensOptions {
  network: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
}

export const setCollectionTokensCommand = new Command("set-collection-tokens")
  .description(
    "Set the ERC-1155 collection + token ID gate for an already-registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .argument("<address>", "Collection address")
  .argument("<tokenIds...>", "Token IDs to gate on")
  .option("--network <network>", NETWORK_OPTION_DESCRIPTION, "base")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option("--rpc-url <url>", "RPC endpoint")
  .option("--dry-run", "Print encoded calldata without transacting")
  .action(
    async (
      toolIdRaw: string,
      addressRaw: string,
      tokenIdsRaw: string[],
      options: SetCollectionTokensOptions,
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

      let collection: Address
      try {
        collection = getAddress(addressRaw)
      } catch {
        console.error(pc.red("Error: invalid collection address"))
        process.exit(1)
      }

      let tokenIds: bigint[]
      try {
        tokenIds = tokenIdsRaw.map(t => BigInt(t))
      } catch {
        console.error(pc.red("Error: invalid token ID (must be numeric)"))
        process.exit(1)
        return
      }

      const predicateAddr = deploymentAddress(ERC1155_OWNER_PREDICATE, chain.id)
      if (!predicateAddr) {
        console.error(
          pc.red(
            `Error: ERC1155OwnerPredicate is not deployed on ${options.network}.`,
          ),
        )
        process.exit(1)
      }

      console.log(pc.bold("Set Collection Tokens"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  Network: ${options.network}`)
      console.log(`  Predicate: ${predicateAddr} (ERC1155OwnerPredicate)`)
      console.log(`  Collection: ${collection}`)
      console.log(`  Token IDs: ${tokenIds.join(", ")}`)

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

      const client = new ERC1155OwnerPredicateClient({
        chain,
        walletClient,
        predicateAddress: predicateAddr,
        rpcUrl: options.rpcUrl,
      })

      try {
        const txHash = await client.setCollectionTokens(toolId, [
          { collection, tokenIds },
        ])
        console.log(pc.green("\nCollection tokens updated!"))
        console.log(`  TX Hash: ${txHash}`)
      } catch (err) {
        console.error(pc.red("Error setting collection tokens:"))
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )
