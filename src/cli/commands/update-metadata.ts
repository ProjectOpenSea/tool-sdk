import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"
import { ToolRegistryClient } from "../../lib/onchain/registry.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletProvider,
  walletAdapterToClient,
} from "../../lib/wallet/index.js"
import { getChain } from "./get-chain.js"

interface UpdateMetadataOptions {
  toolId: string
  metadata: string
  network: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
  yes?: boolean
}

export const updateMetadataCommand = new Command("update-metadata")
  .description("Update a tool's metadata URI and manifest hash onchain")
  .option("--tool-id <id>", "Numeric tool ID (required)")
  .option("--metadata <url>", "New metadata URI (required)")
  .option("--network <network>", "Network: base or mainnet", "base")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option("--rpc-url <url>", "RPC endpoint for gas estimation and tx broadcast")
  .option("--dry-run", "Print summary without transacting")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options: UpdateMetadataOptions) => {
    if (!options.toolId) {
      console.error(pc.red("Error: --tool-id is required"))
      process.exit(1)
    }

    if (!options.metadata) {
      console.error(pc.red("Error: --metadata is required"))
      process.exit(1)
    }

    let toolId: bigint
    try {
      toolId = BigInt(options.toolId)
    } catch {
      console.error(pc.red("Error: --tool-id must be a numeric value"))
      process.exit(1)
    }

    console.log(pc.cyan("Fetching manifest..."))

    let response: globalThis.Response
    try {
      response = await fetch(options.metadata, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      console.error(pc.red(`Error: Failed to fetch ${options.metadata}`))
      process.exit(1)
    }

    if (response.status !== 200) {
      console.error(pc.red(`Error: HTTP ${response.status}`))
      process.exit(1)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      console.error(pc.red("Error: Response is not valid JSON"))
      process.exit(1)
    }

    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("Error: Manifest validation failed"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    const manifest = result.data
    const hash = computeManifestHash(manifest)
    const chain = getChain(options.network)

    console.log(pc.cyan("\nUpdate summary:"))
    console.log(`  Tool ID: ${toolId}`)
    console.log(`  Tool: ${manifest.name}`)
    console.log(`  Network: ${options.network}`)
    console.log(`  New Metadata URI: ${options.metadata}`)
    console.log(`  New Manifest Hash: ${hash}`)

    if (options.dryRun) {
      console.log(pc.yellow("\n  --dry-run: no transaction sent"))
      return
    }

    const wallet = options.walletProvider
      ? createWalletForProvider(options.walletProvider as WalletProvider)
      : createWalletFromEnv()
    const address = await wallet.getAddress()

    console.log(pc.cyan(`\nWallet: ${address} (${wallet.name})`))
    console.log(pc.cyan("Verifying ownership..."))

    const readOnlyRegistry = new ToolRegistryClient({ chain })
    let config: Awaited<ReturnType<ToolRegistryClient["getToolConfig"]>>
    try {
      config = await readOnlyRegistry.getToolConfig(toolId)
    } catch (err) {
      console.error(pc.red("Error: Failed to read tool config"))
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    if (config.creator.toLowerCase() !== address.toLowerCase()) {
      console.error(pc.red("Error: Caller is not the tool creator"))
      console.error(
        pc.dim(`  Creator: ${config.creator}\n  Caller:  ${address}`),
      )
      process.exit(1)
    }

    if (!options.yes) {
      const clack = await import("@clack/prompts")
      const confirm = await clack.confirm({
        message: "Proceed with metadata update?",
      })
      if (!confirm || clack.isCancel(confirm)) {
        console.log(pc.yellow("Cancelled"))
        return
      }
    }

    const walletClient = await walletAdapterToClient(
      wallet,
      chain,
      options.rpcUrl ?? wallet.getRpcUrl?.(),
    )
    const registry = new ToolRegistryClient({ chain, walletClient })

    try {
      const txHash = await registry.updateToolMetadata(
        toolId,
        options.metadata,
        manifest,
      )
      console.log(pc.green("\nMetadata updated!"))
      console.log(`  TX Hash: ${txHash}`)
    } catch (err) {
      console.error(pc.red("Error updating metadata:"))
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })
