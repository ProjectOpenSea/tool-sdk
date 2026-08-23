import { Command } from "commander"
import pc from "picocolors"
import { type Address, createPublicClient, getAddress, http } from "viem"
import {
  deploymentAddress,
  SUBSCRIPTION_PREDICATE,
} from "../../lib/onchain/chains.js"
import { SubscriptionPredicateClient } from "../../lib/onchain/predicate-clients.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  type WalletProvider,
  walletAdapterToClient,
} from "../../lib/wallet/index.js"
import { getChain, NETWORK_OPTION_DESCRIPTION } from "./get-chain.js"
import {
  parseToolId,
  RPC_URL_OPTION_DESCRIPTION,
  resolveRpcUrl,
  WALLET_PROVIDER_OPTION_DESCRIPTION,
} from "./shared.js"

interface ConfigureSubscriptionOptions {
  network: string
  minTier: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
}

export const configureSubscriptionCommand = new Command(
  "configure-subscription",
)
  .description(
    "Configure the SubscriptionPredicate gate for an already-registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .argument("<collection>", "Subscription NFT collection address")
  .option("--min-tier <tier>", "Minimum subscription tier (uint8, 0-255)", "0")
  .option("--network <network>", NETWORK_OPTION_DESCRIPTION, "base")
  .option("--wallet-provider <provider>", WALLET_PROVIDER_OPTION_DESCRIPTION)
  .option("--rpc-url <url>", RPC_URL_OPTION_DESCRIPTION)
  .option("--dry-run", "Print summary without transacting")
  .action(
    async (
      toolIdRaw: string,
      collectionRaw: string,
      options: ConfigureSubscriptionOptions,
    ) => {
      const toolId = parseToolId(toolIdRaw)

      const chain = getChain(options.network)

      let collection: Address
      try {
        collection = getAddress(collectionRaw)
      } catch {
        console.error(pc.red("Error: invalid collection address"))
        process.exit(1)
        return
      }

      const minTier = Number(options.minTier)
      if (!Number.isInteger(minTier) || minTier < 0 || minTier > 255) {
        console.error(
          pc.red("Error: --min-tier must be an integer between 0 and 255"),
        )
        process.exit(1)
        return
      }

      const predicateAddr = deploymentAddress(SUBSCRIPTION_PREDICATE, chain.id)
      if (!predicateAddr) {
        console.error(
          pc.red(
            `Error: SubscriptionPredicate is not deployed on ${options.network}.`,
          ),
        )
        process.exit(1)
        return
      }

      console.log(pc.bold("Configure Subscription"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  Network: ${options.network}`)
      console.log(`  Predicate: ${predicateAddr} (SubscriptionPredicate)`)
      console.log(`  Collection: ${collection}`)
      console.log(`  Min Tier: ${minTier}`)

      if (options.dryRun) {
        console.log(pc.yellow("\n[dry-run] No transaction sent."))
        return
      }

      const adapter = options.walletProvider
        ? await createWalletForProvider(
            options.walletProvider as WalletProvider,
          )
        : await createWalletFromEnv()

      const rpcUrl = resolveRpcUrl(options.rpcUrl, adapter, chain)
      const walletClient = await walletAdapterToClient(adapter, chain, rpcUrl)

      const client = new SubscriptionPredicateClient({
        chain,
        walletClient,
        predicateAddress: predicateAddr,
        rpcUrl,
      })

      try {
        const txHash = await client.configureToolGating(
          toolId,
          collection,
          minTier,
        )

        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        console.log(pc.green("\nSubscription predicate configured!"))
        console.log(`  TX Hash: ${txHash}`)
        console.log(`  Collection: ${collection}`)
        console.log(`  Min Tier: ${minTier}`)
      } catch (err) {
        console.error(pc.red("Error configuring subscription predicate:"))
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )
