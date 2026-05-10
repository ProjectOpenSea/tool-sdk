import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Transport,
  type WalletClient,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
} from "viem"
import type { Access } from "../manifest/types.js"
import { base } from "viem/chains"
import { ERC721_KIND, ERC1155_KIND, SUBSCRIPTION_KIND } from "./access.js"
import {
  ERC721OwnerPredicateABI,
  ERC1155OwnerPredicateABI,
  SubscriptionPredicateABI,
  CompositePredicateABI,
} from "./abis.js"
import {
  type Deployment,
  ERC721_OWNER_PREDICATE,
  ERC1155_OWNER_PREDICATE,
  deploymentAddress,
  getPredicateForRegistryVersion,
} from "./chains.js"

export interface PredicateClientConfig {
  chain?: Chain
  rpcUrl?: string
  walletClient?: WalletClient<Transport, Chain, Account>
  predicateAddress?: `0x${string}`
  /**
   * Registry version string (e.g. "0.1", "0.2"). When set, the client
   * resolves the predicate address from the version-aware mapping instead
   * of using the default (latest) deployment. Ignored when
   * `predicateAddress` is provided explicitly.
   */
  registryVersion?: string
}

abstract class BasePredicateClient {
  protected chain: Chain
  protected walletClient?: WalletClient<Transport, Chain, Account>
  protected predicateAddress: `0x${string}`
  protected publicClient: ReturnType<typeof createPublicClient>

  constructor(
    defaultDeployment: Deployment,
    contractName: string,
    config: PredicateClientConfig = {},
    predicateKind?: "erc721" | "erc1155",
  ) {
    this.chain = config.chain ?? base
    this.walletClient = config.walletClient

    if (config.predicateAddress) {
      this.predicateAddress = config.predicateAddress
    } else {
      const deployment =
        config.registryVersion && predicateKind
          ? getPredicateForRegistryVersion(config.registryVersion, predicateKind)
          : defaultDeployment
      const addr = deploymentAddress(deployment, this.chain.id)
      if (!addr) {
        throw new Error(
          `${contractName} is not deployed on chain ${this.chain.id}. See https://github.com/ProjectOpenSea/opensea-devtools/blob/main/packages/tool-registry/README.md for supported chains.`,
        )
      }
      this.predicateAddress = addr
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })
  }

  protected requireWalletClient(): WalletClient<Transport, Chain, Account> {
    if (!this.walletClient) {
      throw new Error("walletClient required for write operations")
    }
    return this.walletClient
  }

  protected openSeaChainSegment(): string | undefined {
    const id = this.chain.id
    if (id === 8453) return "base"
    if (id === 1) return "ethereum"
    if (id === 137) return "matic"
    return undefined
  }
}

export class ERC721OwnerPredicateClient extends BasePredicateClient {
  constructor(config: PredicateClientConfig = {}) {
    super(ERC721_OWNER_PREDICATE, "ERC721OwnerPredicate", config, "erc721")
  }

  async getCollections(toolId: bigint): Promise<Address[]> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: ERC721OwnerPredicateABI,
      functionName: "getCollections",
      args: [toolId],
    })
    return [...result]
  }

  async setCollections(
    toolId: bigint,
    collections: Address[],
  ): Promise<Hash> {
    const wallet = this.requireWalletClient()
    return wallet.writeContract({
      chain: this.chain,
      account: wallet.account,
      address: this.predicateAddress,
      abi: ERC721OwnerPredicateABI,
      functionName: "setCollections",
      args: [toolId, collections],
    })
  }

  /**
   * Convenience method: reads the current list, appends the new collection, and writes back.
   *
   * **Not safe for concurrent use on the same `toolId`.** This method uses a
   * read-then-write pattern — if two calls race, the second transaction reads
   * stale state and overwrites the first. For concurrent workflows, use
   * {@link setCollections} directly with the full desired list.
   */
  async addCollection(toolId: bigint, collection: Address): Promise<Hash> {
    const current = await this.getCollections(toolId)
    if (current.some((c) => c.toLowerCase() === collection.toLowerCase())) {
      throw new Error(
        `Collection ${collection} is already in the list for tool ${toolId}`,
      )
    }
    return this.setCollections(toolId, [...current, collection])
  }

  /**
   * Convenience method: reads the current list, removes the collection, and writes back.
   *
   * **Not safe for concurrent use on the same `toolId`.** This method uses a
   * read-then-write pattern — if two calls race, the second transaction reads
   * stale state and overwrites the first. For concurrent workflows, use
   * {@link setCollections} directly with the full desired list.
   */
  async removeCollection(toolId: bigint, collection: Address): Promise<Hash> {
    const current = await this.getCollections(toolId)
    const lower = collection.toLowerCase()
    const filtered = current.filter((c) => c.toLowerCase() !== lower)
    if (filtered.length === current.length) {
      throw new Error(
        `Collection ${collection} not found in the list for tool ${toolId}`,
      )
    }
    return this.setCollections(toolId, filtered)
  }

  toManifestAccess(
    collection: Address,
    opts?: { label?: string },
  ): Access {
    const data = encodeAbiParameters(
      [{ type: "address" }],
      [collection],
    )
    const label = opts?.label ?? "Hold any NFT from this collection"
    const segment = this.openSeaChainSegment()
    const normalized = getAddress(collection)
    const links: Record<string, string> | undefined = segment
      ? { opensea: `https://opensea.io/assets/${segment}/${normalized}` }
      : undefined
    return {
      logic: "OR",
      requirements: [{ kind: ERC721_KIND, data, label, links }],
    }
  }
}

export class ERC1155OwnerPredicateClient extends BasePredicateClient {
  constructor(config: PredicateClientConfig = {}) {
    super(ERC1155_OWNER_PREDICATE, "ERC1155OwnerPredicate", config, "erc1155")
  }

  async getCollectionTokens(
    toolId: bigint,
  ): Promise<{ collection: Address; tokenIds: bigint[] }[]> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: ERC1155OwnerPredicateABI,
      functionName: "getCollectionTokens",
      args: [toolId],
    })
    return result.map((entry) => ({
      collection: entry.collection,
      tokenIds: [...entry.tokenIds],
    }))
  }

  async setCollectionTokens(
    toolId: bigint,
    entries: { collection: Address; tokenIds: bigint[] }[],
  ): Promise<Hash> {
    const wallet = this.requireWalletClient()
    return wallet.writeContract({
      chain: this.chain,
      account: wallet.account,
      address: this.predicateAddress,
      abi: ERC1155OwnerPredicateABI,
      functionName: "setCollectionTokens",
      args: [toolId, entries],
    })
  }

  toManifestAccess(
    collection: Address,
    tokenId: bigint,
    opts?: { label?: string },
  ): Access {
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [collection, tokenId],
    )
    const label =
      opts?.label ?? `Hold token #${tokenId} from this collection`
    const segment = this.openSeaChainSegment()
    const normalized = getAddress(collection)
    const links: Record<string, string> | undefined = segment
      ? { opensea: `https://opensea.io/assets/${segment}/${normalized}` }
      : undefined
    return {
      logic: "OR",
      requirements: [{ kind: ERC1155_KIND, data, label, links }],
    }
  }
}

/**
 * No canonical deployment exists for SubscriptionPredicate — each tool
 * creator deploys their own instance. Pass `predicateAddress` explicitly.
 */
const NO_CANONICAL_DEPLOYMENT: Deployment = {
  address: "0x0000000000000000000000000000000000000000",
  chains: [],
}

export class SubscriptionPredicateClient extends BasePredicateClient {
  constructor(
    config: PredicateClientConfig & { predicateAddress: `0x${string}` },
  ) {
    super(NO_CANONICAL_DEPLOYMENT, "SubscriptionPredicate", config)
  }

  async getToolGatingConfig(
    toolId: bigint,
  ): Promise<{ collection: Address; minTier: number }> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: SubscriptionPredicateABI,
      functionName: "getToolGatingConfig",
      args: [toolId],
    })
    return { collection: result.collection, minTier: result.minTier }
  }

  async configureToolGating(
    toolId: bigint,
    collection: Address,
    minTier: number,
  ): Promise<Hash> {
    const wallet = this.requireWalletClient()
    return wallet.writeContract({
      chain: this.chain,
      account: wallet.account,
      address: this.predicateAddress,
      abi: SubscriptionPredicateABI,
      functionName: "configureToolGating",
      args: [toolId, collection, minTier],
    })
  }

  async getSubscriptionStatus(
    toolId: bigint,
    account: Address,
  ): Promise<{
    hasNft: boolean
    tier: number
    requiredTier: number
    expiration: bigint
    active: boolean
  }> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: SubscriptionPredicateABI,
      functionName: "getSubscriptionStatus",
      args: [toolId, account],
    })
    return {
      hasNft: result[0],
      tier: result[1],
      requiredTier: result[2],
      expiration: result[3],
      active: result[4],
    }
  }

  toManifestAccess(
    collection: Address,
    minTier: number,
    opts?: { label?: string },
  ): Access {
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint8" }],
      [collection, minTier],
    )
    const label =
      opts?.label ??
      (minTier > 0
        ? `Active subscription (tier ${minTier}+)`
        : "Active subscription")
    const segment = this.openSeaChainSegment()
    const normalized = getAddress(collection)
    const links: Record<string, string> | undefined = segment
      ? { opensea: `https://opensea.io/assets/${segment}/${normalized}` }
      : undefined
    return {
      logic: "AND",
      requirements: [{ kind: SUBSCRIPTION_KIND, data, label, links }],
    }
  }
}

export enum CompositeOp {
  ALL = 0,
  ANY = 1,
}

export interface CompositeTerm {
  predicate: Address
  negate: boolean
}

export class CompositePredicateClient extends BasePredicateClient {
  constructor(
    config: PredicateClientConfig & { predicateAddress: `0x${string}` },
  ) {
    super(NO_CANONICAL_DEPLOYMENT, "CompositePredicate", config)
  }

  async getOp(toolId: bigint): Promise<CompositeOp> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: CompositePredicateABI,
      functionName: "getOp",
      args: [toolId],
    })
    return result as CompositeOp
  }

  async getTerms(toolId: bigint): Promise<CompositeTerm[]> {
    const result = await this.publicClient.readContract({
      address: this.predicateAddress,
      abi: CompositePredicateABI,
      functionName: "getTerms",
      args: [toolId],
    })
    return result.map((t) => ({
      predicate: t.predicate,
      negate: t.negate,
    }))
  }

  async setComposition(
    toolId: bigint,
    op: CompositeOp,
    terms: CompositeTerm[],
  ): Promise<Hash> {
    const wallet = this.requireWalletClient()
    return wallet.writeContract({
      chain: this.chain,
      account: wallet.account,
      address: this.predicateAddress,
      abi: CompositePredicateABI,
      functionName: "setComposition",
      args: [
        toolId,
        op,
        terms.map((t) => ({
          predicate: t.predicate,
          negate: t.negate,
        })),
      ],
    })
  }
}
