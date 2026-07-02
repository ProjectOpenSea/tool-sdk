import { Command } from "commander"
import pc from "picocolors"
import { type Address, createPublicClient, getAddress, http } from "viem"
import {
  deploymentAddress,
  ERC20_BALANCE_PREDICATE,
} from "../../lib/onchain/chains.js"
import { ERC20BalancePredicateClient } from "../../lib/onchain/predicate-clients.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletProvider,
  walletAdapterToClient,
} from "../../lib/wallet/index.js"
import { getChain } from "./get-chain.js"

interface ConfigureERC20GateOptions {
  network: string
  predicateAddress?: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
}

export const configureERC20GateCommand = new Command("configure-erc20-gate")
  .description(
    "Configure the ERC20BalancePredicate gate for an already-registered tool",
  )
  .argument("<toolId>", "Tool ID (uint256)")
  .argument("<token>", "ERC-20 token contract address")
  .argument(
    "<minBalance>",
    "Minimum token balance required for access (in raw units, e.g. 1000000000000000000 for 1e18)",
  )
  .option(
    "--predicate-address <address>",
    "Override the canonical ERC20BalancePredicate address",
  )
  .option(
    "--network <network>",
    "Network: base, mainnet, shape, abstract, or monad",
    "base",
  )
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option("--rpc-url <url>", "RPC endpoint")
  .option("--dry-run", "Print summary without transacting")
  .action(
    async (
      toolIdRaw: string,
      tokenRaw: string,
      minBalanceRaw: string,
      options: ConfigureERC20GateOptions,
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

      let token: Address
      try {
        token = getAddress(tokenRaw)
      } catch {
        console.error(pc.red("Error: invalid token address"))
        process.exit(1)
        return
      }

      let minBalance: bigint
      try {
        minBalance = BigInt(minBalanceRaw)
        if (minBalance <= 0n) throw new Error("must be positive")
      } catch {
        console.error(pc.red("Error: minBalance must be a positive integer"))
        process.exit(1)
        return
      }

      console.log(pc.bold("Configure ERC-20 Balance Gate"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  Network: ${options.network}`)
      console.log(`  Predicate: ${predicateAddress} (ERC20BalancePredicate)`)
      console.log(`  Token: ${token}`)
      console.log(`  Min Balance: ${minBalance}`)

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

      const client = new ERC20BalancePredicateClient({
        chain,
        walletClient,
        predicateAddress,
        rpcUrl: options.rpcUrl,
      })

      try {
        const txHash = await client.configureToolERC20(
          toolId,
          token,
          minBalance,
        )

        const publicClient = createPublicClient({
          chain,
          transport: http(options.rpcUrl),
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        console.log(pc.green("\nERC-20 balance gate configured!"))
        console.log(`  TX Hash: ${txHash}`)
        console.log(`  Token: ${token}`)
        console.log(`  Min Balance: ${minBalance}`)
      } catch (err) {
        console.error(pc.red("Error configuring ERC-20 balance gate:"))
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )
