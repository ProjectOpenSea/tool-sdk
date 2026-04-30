import { Command } from "commander"
import pc from "picocolors"
import { createPublicClient, http } from "viem"
import { validateManifest } from "../../lib/manifest/index.js"
import { ERC721OwnerPredicateABI } from "../../lib/onchain/abis.js"
import {
  deploymentAddress,
  ERC721_OWNER_PREDICATE,
  TOOL_REGISTRY,
} from "../../lib/onchain/chains.js"
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

interface RegisterOptions {
  metadata: string
  network: string
  nftGate?: string
  accessPredicate?: string
  walletProvider?: string
  rpcUrl?: string
  dryRun?: boolean
  yes?: boolean
}

export const registerCommand = new Command("register")
  .description("Register a tool onchain via the ToolRegistry")
  .option("--metadata <url>", "Metadata URI (required)")
  .option("--network <network>", "Network: base or mainnet", "base")
  .option(
    "--nft-gate <address>",
    "ERC-721 collection address; gates the tool via the canonical ERC721OwnerPredicate",
  )
  .option("--access-predicate <address>", "Manual access predicate address")
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option("--rpc-url <url>", "RPC endpoint for gas estimation and tx broadcast")
  .option("--dry-run", "Print summary without transacting")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options: RegisterOptions) => {
    if (!options.metadata) {
      console.error(pc.red("Error: --metadata is required"))
      process.exit(1)
    }

    if (options.nftGate && options.accessPredicate) {
      console.error(
        pc.red(
          "Error: --nft-gate and --access-predicate are mutually exclusive",
        ),
      )
      process.exit(1)
    }

    console.log(pc.cyan("Verifying manifest..."))

    let response: globalThis.Response
    try {
      response = await fetch(options.metadata, {
        redirect: "manual",
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
      process.exit(1)
    }

    const manifest = result.data
    const hash = computeManifestHash(manifest)
    const chain = getChain(options.network)

    const registryAddr = deploymentAddress(TOOL_REGISTRY, chain.id)
    if (!registryAddr) {
      console.error(
        pc.red(
          `Error: ToolRegistry is not deployed on ${options.network}. See https://github.com/ProjectOpenSea/opensea-devtools/blob/main/packages/tool-registry/README.md for supported chains.`,
        ),
      )
      process.exit(1)
    }

    let accessPredicate =
      "0x0000000000000000000000000000000000000000" as `0x${string}`
    let nftGatePredicate: `0x${string}` | undefined

    if (options.accessPredicate) {
      accessPredicate = options.accessPredicate as `0x${string}`
    } else if (options.nftGate) {
      const predicateAddr = deploymentAddress(ERC721_OWNER_PREDICATE, chain.id)
      if (!predicateAddr) {
        console.error(
          pc.red(
            `Error: ERC721OwnerPredicate not deployed on ${options.network}.`,
          ),
        )
        console.error(pc.yellow("  Provide --access-predicate manually."))
        process.exit(1)
      }
      accessPredicate = predicateAddr
      nftGatePredicate = predicateAddr
    }

    const wallet = options.walletProvider
      ? createWalletForProvider(options.walletProvider as WalletProvider)
      : createWalletFromEnv()
    const address = await wallet.getAddress()

    if (manifest.creatorAddress.toLowerCase() !== address.toLowerCase()) {
      console.error(
        pc.red(
          `Error: manifest.creatorAddress (${manifest.creatorAddress}) does not match your wallet (${address}). The ERC-XXXX spec requires these to match.`,
        ),
      )
      process.exit(1)
    }

    console.log(pc.cyan("\nRegistration summary:"))
    console.log(`  Tool: ${manifest.name}`)
    console.log(`  Network: ${options.network}`)
    console.log(`  Wallet: ${address} (${wallet.name})`)
    console.log(`  Metadata URI: ${options.metadata}`)
    console.log(`  Manifest Hash: ${hash}`)
    if (nftGatePredicate) {
      console.log(
        `  Access Predicate: ${accessPredicate} (ERC721OwnerPredicate, gating collection ${options.nftGate})`,
      )
    } else {
      console.log(`  Access Predicate: ${accessPredicate}`)
    }

    if (options.dryRun) {
      console.log(pc.yellow("\n  --dry-run: no transaction sent"))
      return
    }

    if (!options.yes) {
      const clack = await import("@clack/prompts")
      const confirm = await clack.confirm({
        message: "Proceed with registration?",
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

    const registry = new ToolRegistryClient({
      chain,
      walletClient,
    })

    let toolId: bigint
    try {
      const regResult = await registry.registerTool({
        metadataURI: options.metadata,
        manifest,
        accessPredicate,
      })
      toolId = regResult.toolId
      console.log(pc.green("\nTool registered!"))
      console.log(`  Tool ID: ${toolId}`)
      console.log(`  TX Hash: ${regResult.txHash}`)
    } catch (err) {
      console.error(pc.red("Error registering tool:"))
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    if (nftGatePredicate && options.nftGate) {
      console.log(
        pc.cyan(
          `\nConfiguring ERC721OwnerPredicate gate (collection: ${options.nftGate})...`,
        ),
      )
      const publicClient = createPublicClient({ chain, transport: http() })
      try {
        const txHash = await walletClient.writeContract({
          chain,
          account: walletClient.account,
          address: nftGatePredicate,
          abi: ERC721OwnerPredicateABI,
          functionName: "setCollections",
          args: [toolId, [options.nftGate as `0x${string}`]],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        console.log(pc.green(`  setCollections TX: ${txHash}`))
      } catch (err) {
        console.error(pc.red("Error setting collections on predicate:"))
        console.error(err instanceof Error ? err.message : String(err))
        console.error(
          pc.yellow(
            `  Tool is registered but ungated. Call setCollections(${toolId}, [${options.nftGate}]) manually.`,
          ),
        )
        process.exit(1)
      }
    }
  })
