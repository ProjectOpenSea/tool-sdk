import { Command } from "commander"
import pc from "picocolors"
import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  http,
  isAddress,
  type Transport,
  type WalletClient,
} from "viem"
import { validateManifest } from "../../lib/manifest/index.js"
import { IAccessPredicateABI } from "../../lib/onchain/abis.js"
import {
  deploymentAddress,
  getPredicateForRegistryVersion,
  TOOL_REGISTRY,
} from "../../lib/onchain/chains.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"
import {
  ERC721OwnerPredicateClient,
  ERC1155OwnerPredicateClient,
} from "../../lib/onchain/predicate-clients.js"
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
  predicateConfig?: string
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
    "ERC-721 collection address; gates the tool via the canonical ERC721OwnerPredicate (version auto-detected from registry)",
  )
  .option("--access-predicate <address>", "Access predicate address")
  .option(
    "--predicate-config <json>",
    'JSON config for the access predicate (e.g. \'{"collections":["0x..."]}\')',
  )
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

    if (options.nftGate && !isAddress(options.nftGate)) {
      console.error(
        pc.red(
          `Error: --nft-gate value "${options.nftGate}" is not a valid address`,
        ),
      )
      process.exit(1)
    }

    if (options.predicateConfig && !options.accessPredicate) {
      console.error(
        pc.red("Error: --predicate-config requires --access-predicate"),
      )
      process.exit(1)
    }

    let predicateConfig: Record<string, unknown> | undefined
    if (options.predicateConfig) {
      try {
        predicateConfig = JSON.parse(options.predicateConfig) as Record<
          string,
          unknown
        >
      } catch {
        console.error(pc.red("Error: --predicate-config is not valid JSON"))
        process.exit(1)
        return
      }
    }

    if (options.accessPredicate && !isAddress(options.accessPredicate)) {
      console.error(
        pc.red(
          `Error: --access-predicate value "${options.accessPredicate}" is not a valid address`,
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
          `Error: ToolRegistry is not deployed on ${options.network}. See https://github.com/ProjectOpenSea/tool-registry#readme for supported chains.`,
        ),
      )
      process.exit(1)
    }

    let accessPredicate =
      "0x0000000000000000000000000000000000000000" as `0x${string}`
    let nftGateInfo:
      | { predicateAddr: `0x${string}`; predicateVersion: string }
      | undefined

    let predicateName: string | undefined

    if (options.accessPredicate) {
      accessPredicate = options.accessPredicate as `0x${string}`

      const publicClient = createPublicClient({
        chain,
        transport: http(options.rpcUrl),
      })
      try {
        predicateName = await publicClient.readContract({
          address: accessPredicate,
          abi: IAccessPredicateABI,
          functionName: "name",
        })
      } catch {
        predicateName = undefined
      }

      if (predicateConfig && predicateName) {
        validatePredicateConfig(predicateName, predicateConfig)
      }
    } else if (options.nftGate) {
      const readOnlyRegistry = new ToolRegistryClient({
        chain,
        rpcUrl: options.rpcUrl,
      })

      let registryVersion: string
      try {
        registryVersion = await readOnlyRegistry.version()
      } catch {
        console.error(
          pc.red(
            "Error: Failed to read registry version. Cannot auto-detect predicate version.",
          ),
        )
        console.error(
          pc.yellow(
            "  Use --access-predicate to specify the predicate address manually.",
          ),
        )
        process.exit(1)
      }

      const predicateDeploy = getPredicateForRegistryVersion(
        registryVersion,
        "erc721",
      )
      const predicateAddr = deploymentAddress(predicateDeploy, chain.id)
      if (!predicateAddr) {
        console.error(
          pc.red(
            `Error: ERC721OwnerPredicate (matching registry v${registryVersion}) is not deployed on ${options.network}.`,
          ),
        )
        console.error(
          pc.yellow(
            "  Use --access-predicate to specify the predicate address manually.",
          ),
        )
        process.exit(1)
      }
      accessPredicate = predicateAddr
      nftGateInfo = { predicateAddr, predicateVersion: registryVersion }
    }

    const wallet = options.walletProvider
      ? createWalletForProvider(options.walletProvider as WalletProvider)
      : createWalletFromEnv()
    const address = (await wallet.getAddress()).toLowerCase()

    if (manifest.creatorAddress !== address) {
      console.error(
        pc.red(
          `Error: manifest.creatorAddress (${manifest.creatorAddress}) does not match your wallet (${address}). The ERC-8257 spec requires these to match.`,
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
    if (nftGateInfo) {
      console.log(
        `  Access Predicate: ${nftGateInfo.predicateAddr} (ERC721OwnerPredicate v${nftGateInfo.predicateVersion}, gating collection ${options.nftGate})`,
      )
    } else if (options.accessPredicate) {
      const label = predicateName
        ? `${accessPredicate} (${predicateName})`
        : `${accessPredicate}`
      console.log(`  Access Predicate: ${label}`)
      if (predicateConfig) {
        console.log(`  Predicate Config: ${JSON.stringify(predicateConfig)}`)
      }
    } else {
      console.log(`  Access Predicate: ${accessPredicate}`)
    }

    if (!manifest.access && options.nftGate) {
      const predicate = new ERC721OwnerPredicateClient({
        chain,
        predicateAddress: nftGateInfo?.predicateAddr,
      })
      const access = predicate.toManifestAccess(
        options.nftGate as `0x${string}`,
      )
      const accessJson = JSON.stringify(access, null, 2)

      console.log(
        pc.yellow(
          "\nYour manifest does not include an access field. " +
            "Adding one lets agents discover the gating requirement and find your collection on OpenSea.",
        ),
      )
      console.log(pc.cyan("\nSuggested access block:"))
      console.log(accessJson)
    }

    if (options.accessPredicate && !predicateConfig) {
      const configHint =
        predicateName === "ERC721OwnerPredicate"
          ? 'Use --predicate-config \'{"collections":["0x..."]}\' or run `tool-sdk set-collections` after registration.'
          : predicateName === "ERC1155OwnerPredicate"
            ? 'Use --predicate-config \'{"collection":"0x...","tokenIds":["1","2"]}\' or run `tool-sdk set-collection-tokens` after registration.'
            : predicateName === "SubscriptionPredicate"
              ? "Configure the subscription predicate (e.g. configureToolGating) after registration."
              : "Configure the predicate after registration to enforce access control."
      console.log(
        pc.yellow(
          `\n  WARNING: predicate ${accessPredicate} registered but not configured.` +
            "\n  Tool will accept any caller until you configure the predicate." +
            `\n  ${configHint}`,
        ),
      )
    }

    if (options.dryRun) {
      if (predicateConfig && options.accessPredicate) {
        console.log(
          pc.cyan("\n  Predicate config TX would be sent after registration."),
        )
      }
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

    let regResult: { toolId: bigint; txHash: string }
    try {
      regResult = await registry.registerTool({
        metadataURI: options.metadata,
        manifest,
        accessPredicate,
      })
    } catch (err) {
      console.error(pc.red("Error registering tool:"))
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
      return
    }

    console.log(pc.green("\nTool registered!"))
    console.log(`  Tool ID: ${regResult.toolId}`)
    console.log(`  TX Hash: ${regResult.txHash}`)

    if (options.nftGate && nftGateInfo) {
      console.log(
        pc.cyan(
          `\nNext step: configure the predicate to gate on your collection:\n` +
            `  tool-sdk set-collections ${regResult.toolId} ${options.nftGate} --network ${options.network}`,
        ),
      )
    }

    if (options.accessPredicate && predicateConfig) {
      try {
        await executePredicateConfig({
          predicateName,
          predicateAddress: accessPredicate,
          toolId: regResult.toolId,
          config: predicateConfig,
          chain,
          walletClient,
        })
      } catch (err) {
        console.error(
          pc.red(
            `\nTool registered as toolId ${regResult.toolId}, but predicate config failed:`,
          ),
        )
        console.error(err instanceof Error ? err.message : String(err))
        const recoveryCmd =
          predicateName === "ERC1155OwnerPredicate"
            ? `tool-sdk set-collection-tokens ${regResult.toolId} <collection> <tokenIds...> --network ${options.network}`
            : `tool-sdk set-collections ${regResult.toolId} <collection> --network ${options.network}`
        console.error(pc.yellow(`\n  Recovery: run \`${recoveryCmd}\``))
        process.exit(1)
      }
    }
  })

interface PredicateConfigParams {
  predicateName: string | undefined
  predicateAddress: `0x${string}`
  toolId: bigint
  config: Record<string, unknown>
  chain: Chain
  walletClient: WalletClient<Transport, Chain, Account>
}

function validatePredicateConfig(
  predicateName: string,
  config: Record<string, unknown>,
) {
  if (predicateName === "ERC721OwnerPredicate") {
    const collections = config.collections
    if (!Array.isArray(collections) || collections.length === 0) {
      console.error(
        pc.red(
          'Error: ERC721OwnerPredicate config requires "collections" array of addresses',
        ),
      )
      process.exit(1)
    }
    for (const c of collections) {
      if (typeof c !== "string" || !isAddress(c)) {
        console.error(pc.red(`Error: invalid collection address "${c}"`))
        process.exit(1)
      }
    }
  } else if (predicateName === "ERC1155OwnerPredicate") {
    const collection = config.collection
    const tokenIds = config.tokenIds
    if (typeof collection !== "string" || !isAddress(collection)) {
      console.error(
        pc.red(
          'Error: ERC1155OwnerPredicate config requires "collection" address',
        ),
      )
      process.exit(1)
    }
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      console.error(
        pc.red('Error: ERC1155OwnerPredicate config requires "tokenIds" array'),
      )
      process.exit(1)
    }
    try {
      tokenIds.map(t => BigInt(t as string))
    } catch {
      console.error(pc.red("Error: invalid token ID (must be numeric)"))
      process.exit(1)
    }
  }
}

async function executePredicateConfig(params: PredicateConfigParams) {
  const {
    predicateName,
    predicateAddress,
    toolId,
    config,
    chain,
    walletClient,
  } = params

  if (predicateName === "ERC721OwnerPredicate") {
    const collections = (config.collections as string[]).map(c => c as Address)
    const predicate = new ERC721OwnerPredicateClient({
      chain,
      walletClient,
      predicateAddress,
    })
    const txHash = await predicate.setCollections(toolId, collections)
    console.log(pc.green("\nPredicate configured!"))
    console.log(`  setCollections TX: ${txHash}`)
    return
  }

  if (predicateName === "ERC1155OwnerPredicate") {
    const collection = config.collection as Address
    const parsedTokenIds = (config.tokenIds as string[]).map(t => BigInt(t))
    const predicate = new ERC1155OwnerPredicateClient({
      chain,
      walletClient,
      predicateAddress,
    })
    const txHash = await predicate.setCollectionTokens(toolId, [
      { collection, tokenIds: parsedTokenIds },
    ])
    console.log(pc.green("\nPredicate configured!"))
    console.log(`  setCollectionTokens TX: ${txHash}`)
    return
  }

  console.log(
    pc.yellow(
      `\n  WARNING: predicate "${predicateName ?? "unknown"}" is not a recognized type.` +
        "\n  --predicate-config was ignored. Configure the predicate manually.",
    ),
  )
}
