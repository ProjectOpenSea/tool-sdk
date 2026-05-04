import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type Transport,
  type WalletClient,
  createPublicClient,
  http,
  parseEventLogs,
  zeroAddress,
} from "viem"
import { base } from "viem/chains"
import type { ToolManifest } from "../manifest/types.js"
import { computeManifestHash } from "./hash.js"
import { IToolRegistryABI, ToolRegisteredEvent } from "./abis.js"
import { TOOL_REGISTRY, deploymentAddress } from "./chains.js"

interface ToolConfig {
  creator: Address
  metadataURI: string
  manifestHash: Hex
  accessPredicate: Address
}

export class ToolRegistryClient {
  private chain: Chain
  private walletClient?: WalletClient<Transport, Chain, Account>
  private registryAddress: `0x${string}`
  private publicClient: ReturnType<typeof createPublicClient>

  constructor(config: {
    chain?: Chain
    rpcUrl?: string
    walletClient?: WalletClient<Transport, Chain, Account>
    registryAddress?: `0x${string}`
  }) {
    this.chain = config.chain ?? base
    this.walletClient = config.walletClient

    if (config.registryAddress) {
      this.registryAddress = config.registryAddress
    } else {
      const addr = deploymentAddress(TOOL_REGISTRY, this.chain.id)
      if (!addr) {
        throw new Error(
          `ToolRegistry is not deployed on chain ${this.chain.id}. See https://github.com/ProjectOpenSea/tool-registry#readme for supported chains.`,
        )
      }
      this.registryAddress = addr
    }
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })
  }

  async getToolConfig(toolId: bigint): Promise<ToolConfig> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "getToolConfig",
      args: [toolId],
    })
    return {
      creator: result.creator,
      metadataURI: result.metadataURI,
      manifestHash: result.manifestHash,
      accessPredicate: result.accessPredicate,
    }
  }

  async hasAccess(
    toolId: bigint,
    account: Address,
    data?: Hex,
  ): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "hasAccess",
      args: [toolId, account, data ?? "0x"],
    })
  }

  /**
   * Calls the registry's `tryHasAccess`, which distinguishes "predicate said no"
   * from "predicate misbehaved" (e.g. ran out of gas or returned malformed data).
   *
   * - `(ok=true, granted=true)`: the predicate granted access.
   * - `(ok=true, granted=false)`: the predicate denied access.
   * - `(ok=false, *)`: the predicate misbehaved; treat as a 5xx, not a 403.
   *
   * Open-access tools (`accessPredicate == address(0)`) return `(true, true)`.
   */
  async tryHasAccess(
    toolId: bigint,
    account: Address,
    data?: Hex,
  ): Promise<{ ok: boolean; granted: boolean }> {
    const [ok, granted] = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "tryHasAccess",
      args: [toolId, account, data ?? "0x"],
    })
    return { ok, granted }
  }

  async toolCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "toolCount",
    })
  }

  async name(): Promise<string> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "name",
    })
  }

  async version(): Promise<string> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "version",
    })
  }

  async registerTool(params: {
    metadataURI: string
    manifest: ToolManifest
    accessPredicate?: Address
  }): Promise<{ toolId: bigint; txHash: Hash }> {
    if (!this.walletClient) {
      throw new Error(
        "walletClient required for write operations",
      )
    }
    const manifestHash = computeManifestHash(params.manifest)
    const predicate = params.accessPredicate ?? zeroAddress

    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account,
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "registerTool",
      args: [params.metadataURI, manifestHash, predicate],
    })

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    })

    const logs = parseEventLogs({
      abi: IToolRegistryABI,
      eventName: "ToolRegistered",
      logs: receipt.logs,
    })

    if (logs.length === 0) {
      throw new Error(
        "ToolRegistered event not found in transaction receipt",
      )
    }

    return {
      toolId: logs[0].args.toolId,
      txHash: receipt.transactionHash,
    }
  }

  async updateToolMetadata(
    toolId: bigint,
    newURI: string,
    manifest: ToolManifest,
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error(
        "walletClient required for write operations",
      )
    }
    const manifestHash = computeManifestHash(manifest)
    return this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account,
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "updateToolMetadata",
      args: [toolId, newURI, manifestHash],
    })
  }

  async listToolsByCreator(
    creator: Address,
    options?: { fromBlock?: bigint; toBlock?: bigint },
  ): Promise<
    {
      toolId: bigint
      accessPredicate: Address
      metadataURI: string
      manifestHash: Hex
      txHash: Hash
      blockNumber: bigint
    }[]
  > {
    const toBlock = options?.toBlock ?? "latest"
    const fromBlock =
      options?.fromBlock ??
      (await this.publicClient.getBlockNumber()) - 10_000n

    const logs = await this.publicClient.getLogs({
      address: this.registryAddress,
      event: ToolRegisteredEvent,
      args: { creator },
      fromBlock,
      toBlock,
    })

    return logs.map((log) => ({
      toolId: log.args.toolId!,
      accessPredicate: log.args.accessPredicate!,
      metadataURI: log.args.metadataURI!,
      manifestHash: log.args.manifestHash!,
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
    }))
  }

  async setAccessPredicate(
    toolId: bigint,
    predicate: Address,
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error(
        "walletClient required for write operations",
      )
    }
    return this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account,
      address: this.registryAddress,
      abi: IToolRegistryABI,
      functionName: "setAccessPredicate",
      args: [toolId, predicate],
    })
  }
}
