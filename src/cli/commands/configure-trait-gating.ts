import { Command } from "commander"
import pc from "picocolors"
import { type Address, createPublicClient, getAddress, http, toHex } from "viem"
import {
  deploymentAddress,
  TRAIT_GATED_PREDICATE,
} from "../../lib/onchain/chains.js"
import { TraitGatedPredicateClient } from "../../lib/onchain/predicate-clients.js"
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

interface ConfigureTraitGatingOptions {
  network: string
  predicateAddress?: string
  traitsContract?: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
}

export const configureTraitGatingCommand = new Command("configure-trait-gating")
  .description(
    "Configure the TraitGatedPredicate gate for an already-registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .argument("<collection>", "ERC-721 collection address (for ownerOf)")
  .argument(
    "<traitKey>",
    "Trait key string (e.g. 'tier'). Encoded as left-aligned bytes32.",
  )
  .argument(
    "<allowedValues...>",
    "One or more allowed trait value strings (e.g. 'Rare' 'Legendary'). " +
      "Values are left-aligned bytes32 — must match exactly how the traits contract stores them. " +
      "bytes32(0) is not allowed (it is the default for unset traits).",
  )
  .option(
    "--predicate-address <address>",
    "Override the canonical TraitGatedPredicate address",
  )
  .option(
    "--traits-contract <address>",
    "ERC-7496 traits contract address (defaults to collection if omitted)",
  )
  .option("--network <network>", NETWORK_OPTION_DESCRIPTION, "base")
  .option("--wallet-provider <provider>", WALLET_PROVIDER_OPTION_DESCRIPTION)
  .option("--rpc-url <url>", RPC_URL_OPTION_DESCRIPTION)
  .option("--dry-run", "Print summary without transacting")
  .action(
    async (
      toolIdRaw: string,
      collectionRaw: string,
      traitKeyRaw: string,
      allowedValuesRaw: string[],
      options: ConfigureTraitGatingOptions,
    ) => {
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

      let collection: Address
      try {
        collection = getAddress(collectionRaw)
      } catch {
        console.error(pc.red("Error: invalid collection address"))
        process.exit(1)
        return
      }

      let traitsContract: Address
      if (options.traitsContract) {
        try {
          traitsContract = getAddress(options.traitsContract)
        } catch {
          console.error(pc.red("Error: invalid --traits-contract address"))
          process.exit(1)
          return
        }
      } else {
        traitsContract = collection
      }

      const traitKey = toHex(traitKeyRaw, { size: 32 })
      const allowedValues = allowedValuesRaw.map(v => toHex(v, { size: 32 }))

      console.log(pc.bold("Configure Trait Gating"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  Network: ${options.network}`)
      console.log(`  Predicate: ${predicateAddress} (TraitGatedPredicate)`)
      console.log(`  Collection: ${collection}`)
      console.log(`  Traits Contract: ${traitsContract}`)
      console.log(`  Trait Key: "${traitKeyRaw}" (${traitKey})`)
      console.log(`  Allowed Values:`)
      for (const v of allowedValuesRaw) {
        console.log(`    - "${v}"`)
      }

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

      const client = new TraitGatedPredicateClient({
        chain,
        walletClient,
        predicateAddress,
        rpcUrl,
      })

      try {
        const txHash = await client.configureToolTrait(
          toolId,
          collection,
          traitsContract,
          traitKey,
          allowedValues,
        )

        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        console.log(pc.green("\nTrait gating configured!"))
        console.log(`  TX Hash: ${txHash}`)
        console.log(`  Collection: ${collection}`)
        console.log(`  Traits Contract: ${traitsContract}`)
        console.log(`  Trait Key: "${traitKeyRaw}"`)
        console.log(
          `  Allowed Values: ${allowedValuesRaw.map(v => `"${v}"`).join(", ")}`,
        )
      } catch (err) {
        console.error(pc.red("Error configuring trait gating:"))
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )
