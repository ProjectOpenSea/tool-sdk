import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  type Hash,
  http,
  type ReadContractParameters,
  type ReadContractReturnType,
  type Transport,
  type WalletClient,
  type WriteContractParameters,
} from "viem"
import { base } from "viem/chains"
import type { Access } from "../manifest/types.js"
import {
  CompositePredicateABI,
  ERC20BalancePredicateABI,
  ERC721OwnerPredicateABI,
  ERC1155OwnerPredicateABI,
  SubscriptionPredicateABI,
  TraitGatedPredicateABI,
} from "./abis.js"
import {
  ERC20_BALANCE_KIND,
  ERC721_KIND,
  ERC1155_KIND,
  ERC7496_TRAIT_KIND,
  SUBSCRIPTION_KIND,
} from "./access.js"
import {
  type Deployment,
  deploymentAddress,
  ERC20_BALANCE_PREDICATE,
  ERC721_OWNER_PREDICATE,
  ERC1155_OWNER_PREDICATE,
  SUBSCRIPTION_PREDICATE,
  TRAIT_GATED_PREDICATE,
} from "./chains.js"

export interface PredicateClientConfig {
  chain?: Chain
  rpcUrl?: string
  walletClient?: WalletClient<Transport, Chain, Account>
  predicateAddress?: `0x${string}`
}

abstract class BasePredicateClient<const TAbi extends Abi> {
  protected chain: Chain
  protected walletClient?: WalletClient<Transport, Chain, Account>
  protected predicateAddress: `0x${string}`
  protected publicClient: ReturnType<typeof createPublicClient>
  protected abi: TAbi

  constructor(
    defaultDeployment: Deployment,
    contractName: string,
    abi: TAbi,
    config: PredicateClientConfig = {},
  ) {
    this.abi = abi
    this.chain = config.chain ?? base
    this.walletClient = config.walletClient

    if (config.predicateAddress) {
      this.predicateAddress = config.predicateAddress
    } else {
      const addr = deploymentAddress(defaultDeployment, this.chain.id)
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

  /** Read a view/pure function on this predicate at the resolved address. */
  protected read<
    fn extends ContractFunctionName<TAbi, "pure" | "view">,
    const args extends ContractFunctionArgs<TAbi, "pure" | "view", fn>,
  >(
    functionName: fn,
    args: args,
  ): Promise<ReadContractReturnType<TAbi, fn, args>> {
    return this.publicClient.readContract({
      address: this.predicateAddress,
      abi: this.abi,
      functionName,
      args,
    } as ReadContractParameters<TAbi, fn, args>) as Promise<
      ReadContractReturnType<TAbi, fn, args>
    >
  }

  /** Send a state-changing transaction to this predicate; requires a wallet. */
  protected write<
    fn extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
    const args extends ContractFunctionArgs<TAbi, "nonpayable" | "payable", fn>,
  >(functionName: fn, args: args): Promise<Hash> {
    const wallet = this.requireWalletClient()
    return wallet.writeContract({
      chain: this.chain,
      account: wallet.account,
      address: this.predicateAddress,
      abi: this.abi,
      functionName,
      args,
    } as WriteContractParameters<TAbi, fn, args, Chain, Account>)
  }

  protected openSeaChainSegment(): string | undefined {
    const id = this.chain.id
    if (id === 8453) return "base"
    if (id === 1) return "ethereum"
    if (id === 137) return "matic"
    return undefined
  }

  /**
   * Build the `links` map for a manifest requirement pointing at an asset's
   * OpenSea page, or `undefined` when the active chain has no OpenSea path.
   */
  protected openSeaAssetLinks(
    collection: Address,
  ): Record<string, string> | undefined {
    const segment = this.openSeaChainSegment()
    if (!segment) return undefined
    return {
      opensea: `https://opensea.io/assets/${segment}/${getAddress(collection)}`,
    }
  }
}

export class ERC721OwnerPredicateClient extends BasePredicateClient<
  typeof ERC721OwnerPredicateABI
> {
  constructor(config: PredicateClientConfig = {}) {
    super(
      ERC721_OWNER_PREDICATE,
      "ERC721OwnerPredicate",
      ERC721OwnerPredicateABI,
      config,
    )
  }

  async getCollections(toolId: bigint): Promise<Address[]> {
    const result = await this.read("getCollections", [toolId])
    return [...result]
  }

  async setCollections(toolId: bigint, collections: Address[]): Promise<Hash> {
    return this.write("setCollections", [toolId, collections])
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
    if (current.some(c => c.toLowerCase() === collection.toLowerCase())) {
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
    const filtered = current.filter(c => c.toLowerCase() !== lower)
    if (filtered.length === current.length) {
      throw new Error(
        `Collection ${collection} not found in the list for tool ${toolId}`,
      )
    }
    return this.setCollections(toolId, filtered)
  }

  toManifestAccess(collection: Address, opts?: { label?: string }): Access {
    const data = encodeAbiParameters([{ type: "address" }], [collection])
    const label = opts?.label ?? "Hold any NFT from this collection"
    const links = this.openSeaAssetLinks(collection)
    return {
      logic: "OR",
      requirements: [{ kind: ERC721_KIND, data, label, links }],
    }
  }
}

export class ERC1155OwnerPredicateClient extends BasePredicateClient<
  typeof ERC1155OwnerPredicateABI
> {
  constructor(config: PredicateClientConfig = {}) {
    super(
      ERC1155_OWNER_PREDICATE,
      "ERC1155OwnerPredicate",
      ERC1155OwnerPredicateABI,
      config,
    )
  }

  async getCollectionTokens(
    toolId: bigint,
  ): Promise<{ collection: Address; tokenIds: bigint[] }[]> {
    const result = await this.read("getCollectionTokens", [toolId])
    return result.map(entry => ({
      collection: entry.collection,
      tokenIds: [...entry.tokenIds],
    }))
  }

  async setCollectionTokens(
    toolId: bigint,
    entries: { collection: Address; tokenIds: bigint[] }[],
  ): Promise<Hash> {
    return this.write("setCollectionTokens", [toolId, entries])
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
    const label = opts?.label ?? `Hold token #${tokenId} from this collection`
    const links = this.openSeaAssetLinks(collection)
    return {
      logic: "OR",
      requirements: [{ kind: ERC1155_KIND, data, label, links }],
    }
  }
}

/**
 * CompositePredicate has no canonical deployment — each tool creator deploys
 * their own instance. Pass `predicateAddress` explicitly.
 */
const NO_CANONICAL_DEPLOYMENT: Deployment = {
  address: "0x0000000000000000000000000000000000000000",
  chains: [],
}

export class SubscriptionPredicateClient extends BasePredicateClient<
  typeof SubscriptionPredicateABI
> {
  constructor(config: PredicateClientConfig = {}) {
    super(
      SUBSCRIPTION_PREDICATE,
      "SubscriptionPredicate",
      SubscriptionPredicateABI,
      config,
    )
  }

  async getToolGatingConfig(
    toolId: bigint,
  ): Promise<{ collection: Address; minTier: number }> {
    const result = await this.read("getToolGatingConfig", [toolId])
    return { collection: result.collection, minTier: result.minTier }
  }

  async configureToolGating(
    toolId: bigint,
    collection: Address,
    minTier: number,
  ): Promise<Hash> {
    return this.write("configureToolGating", [toolId, collection, minTier])
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
    const result = await this.read("getSubscriptionStatus", [toolId, account])
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
    const links = this.openSeaAssetLinks(collection)
    return {
      logic: "AND",
      requirements: [{ kind: SUBSCRIPTION_KIND, data, label, links }],
    }
  }
}

export class TraitGatedPredicateClient extends BasePredicateClient<
  typeof TraitGatedPredicateABI
> {
  constructor(config: PredicateClientConfig = {}) {
    super(
      TRAIT_GATED_PREDICATE,
      "TraitGatedPredicate",
      TraitGatedPredicateABI,
      config,
    )
  }

  async getToolTraitConfig(toolId: bigint): Promise<{
    collection: Address
    traitsContract: Address
    traitKey: `0x${string}`
    allowedValues: readonly `0x${string}`[]
  }> {
    const result = await this.read("getToolTraitConfig", [toolId])
    return {
      collection: result.collection,
      traitsContract: result.traitsContract,
      traitKey: result.traitKey,
      allowedValues: result.allowedValues,
    }
  }

  async configureToolTrait(
    toolId: bigint,
    collection: Address,
    traitsContract: Address,
    traitKey: `0x${string}`,
    allowedValues: `0x${string}`[],
  ): Promise<Hash> {
    return this.write("configureToolTrait", [
      toolId,
      collection,
      traitsContract,
      traitKey,
      allowedValues,
    ])
  }

  toManifestAccess(
    collection: Address,
    traitsContract: Address,
    traitKey: `0x${string}`,
    allowedValues: `0x${string}`[],
    opts?: { label?: string },
  ): Access {
    const data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32[]" },
      ],
      [collection, traitsContract, traitKey, allowedValues],
    )
    const label = opts?.label ?? "Hold an NFT with a matching trait"
    const links = this.openSeaAssetLinks(collection)
    return {
      logic: "AND",
      requirements: [{ kind: ERC7496_TRAIT_KIND, data, label, links }],
    }
  }
}

export class ERC20BalancePredicateClient extends BasePredicateClient<
  typeof ERC20BalancePredicateABI
> {
  constructor(config: PredicateClientConfig = {}) {
    super(
      ERC20_BALANCE_PREDICATE,
      "ERC20BalancePredicate",
      ERC20BalancePredicateABI,
      config,
    )
  }

  async getToolERC20Config(
    toolId: bigint,
  ): Promise<{ token: Address; minBalance: bigint }> {
    const result = await this.read("getToolERC20Config", [toolId])
    return {
      token: result.token,
      minBalance: result.minBalance,
    }
  }

  async configureToolERC20(
    toolId: bigint,
    token: Address,
    minBalance: bigint,
  ): Promise<Hash> {
    return this.write("configureToolERC20", [toolId, token, minBalance])
  }

  /**
   * Build a manifest `access` block for an ERC-20 balance gate.
   *
   * **Important:** The default label renders `minBalance` as a raw bigint
   * (e.g. `"1000000000000000000"`). For user-facing gates, always supply a
   * human-readable `opts.label` (e.g. `"Hold at least 1 USDC"`).
   */
  toManifestAccess(
    token: Address,
    minBalance: bigint,
    opts?: { label?: string },
  ): Access {
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [token, minBalance],
    )
    const label = opts?.label ?? `Hold at least ${minBalance} of this token`
    return {
      logic: "AND",
      requirements: [{ kind: ERC20_BALANCE_KIND, data, label }],
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

export class CompositePredicateClient extends BasePredicateClient<
  typeof CompositePredicateABI
> {
  constructor(
    config: PredicateClientConfig & { predicateAddress: `0x${string}` },
  ) {
    super(
      NO_CANONICAL_DEPLOYMENT,
      "CompositePredicate",
      CompositePredicateABI,
      config,
    )
  }

  async getOp(toolId: bigint): Promise<CompositeOp> {
    const result = await this.read("getOp", [toolId])
    return result as CompositeOp
  }

  async getTerms(toolId: bigint): Promise<CompositeTerm[]> {
    const result = await this.read("getTerms", [toolId])
    return result.map(t => ({
      predicate: t.predicate,
      negate: t.negate,
    }))
  }

  async setComposition(
    toolId: bigint,
    op: CompositeOp,
    terms: CompositeTerm[],
  ): Promise<Hash> {
    return this.write("setComposition", [
      toolId,
      op,
      terms.map(t => ({
        predicate: t.predicate,
        negate: t.negate,
      })),
    ])
  }
}
