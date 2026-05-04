import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Transport,
  type WalletClient,
  createPublicClient,
  http,
} from "viem"
import { base } from "viem/chains"
import { ERC721OwnerPredicateABI, ERC1155OwnerPredicateABI } from "./abis.js"
import {
  type Deployment,
  ERC721_OWNER_PREDICATE,
  ERC1155_OWNER_PREDICATE,
  deploymentAddress,
} from "./chains.js"

export interface PredicateClientConfig {
  chain?: Chain
  rpcUrl?: string
  walletClient?: WalletClient<Transport, Chain, Account>
  predicateAddress?: `0x${string}`
}

abstract class BasePredicateClient {
  protected chain: Chain
  protected walletClient?: WalletClient<Transport, Chain, Account>
  protected predicateAddress: `0x${string}`
  protected publicClient: ReturnType<typeof createPublicClient>

  constructor(
    deployment: Deployment,
    contractName: string,
    config: PredicateClientConfig = {},
  ) {
    this.chain = config.chain ?? base
    this.walletClient = config.walletClient

    if (config.predicateAddress) {
      this.predicateAddress = config.predicateAddress
    } else {
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
}

export class ERC721OwnerPredicateClient extends BasePredicateClient {
  constructor(config: PredicateClientConfig = {}) {
    super(ERC721_OWNER_PREDICATE, "ERC721OwnerPredicate", config)
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
}

export class ERC1155OwnerPredicateClient extends BasePredicateClient {
  constructor(config: PredicateClientConfig = {}) {
    super(ERC1155_OWNER_PREDICATE, "ERC1155OwnerPredicate", config)
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
}
