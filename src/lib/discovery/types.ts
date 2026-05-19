import type { Address, Chain, Hex } from "viem"

/**
 * A parsed CAIP-19 asset identifier for an ERC-8257 tool registration.
 *
 * Format: `eip155:<chainId>/erc8257:<registryAddress>/<toolId>`
 */
export interface CAIP19ToolRef {
  /** The raw CAIP-19 string. */
  raw: string
  /** EVM chain ID (e.g. 1, 8453). */
  chainId: number
  /** Registry contract address. */
  registryAddress: Address
  /** Onchain tool ID. */
  toolId: bigint
}

/**
 * An ENS subname discovered under the root name that carries an Application
 * schema with tool registrations.
 */
export interface ApplicationSubname {
  /** Fully-qualified ENS name (e.g. "web.uniswap.eth"). */
  name: string
  /** CAIP-19 tool references declared in the Application schema. */
  registrations: CAIP19ToolRef[]
}

/**
 * Result of verifying the two-way origin link between an ENS attestation and
 * the tool's own origin attestation.
 */
export interface OriginVerification {
  /** Origin derived from the tool's manifest endpoint. */
  toolOrigin: string
  /** Attestation URL retrieved from the ENS `attestations[{CAIP-19}]` record. */
  ensAttestationUrl: string | null
  /** Origin of the ENS attestation URL. */
  ensAttestationOrigin: string | null
  /** Whether both origins match (the loop is closed). */
  verified: boolean
}

/** Onchain tool configuration from the ERC-8257 registry. */
export interface ToolConfig {
  creator: Address
  metadataURI: string
  manifestHash: Hex
  accessPredicate: Address
}

/** A fully resolved tool discovered via ENS traversal. */
export interface DiscoveredTool {
  /** The Application subname this tool was found under. */
  sourceName: string
  /** CAIP-19 identifier. */
  caip19: CAIP19ToolRef
  /** Onchain tool config from the 8257 registry. */
  config: ToolConfig
  /** Origin verification result. */
  originVerification: OriginVerification
}

/** Full result of the ENS discovery traversal. */
export interface ENSDiscoveryResult {
  /** The root ENS name queried. */
  ensName: string
  /** Subnames that were identified as Applications. */
  applications: ApplicationSubname[]
  /** All tools discovered and verified. */
  tools: DiscoveredTool[]
  /** Errors encountered during traversal (non-fatal). */
  errors: ENSDiscoveryError[]
}

export interface ENSDiscoveryError {
  /** Which phase the error occurred in. */
  phase: "subname-resolution" | "schema-read" | "registry-fetch" | "attestation-verify"
  /** Context (e.g. the subname or CAIP-19 reference). */
  context: string
  /** Error message. */
  message: string
}

/**
 * Pluggable interface for resolving subnames under an ENS name.
 * ENS does not provide onchain subname enumeration, so consumers can
 * supply their own data source (subgraph, API, static list, etc.).
 */
export interface SubnameResolver {
  /**
   * Returns the fully-qualified subnames under the given ENS name.
   * Should NOT include the root name itself.
   */
  resolveSubnames(ensName: string): Promise<string[]>
}

/**
 * Configuration for the ENS discovery traversal.
 */
export interface ENSDiscoveryOptions {
  /** Root ENS name to traverse (e.g. "uniswap.eth"). */
  ensName: string
  /** Chain for ENS resolution (defaults to Ethereum mainnet). */
  ensChain?: Chain
  /** RPC URL for ENS resolution (L1). */
  ensRpcUrl?: string
  /** Chain where the 8257 registry is deployed (defaults to Base). */
  registryChain?: Chain
  /** RPC URL for registry reads. */
  registryRpcUrl?: string
  /**
   * Subname resolver implementation. If not provided, uses the ENS subgraph.
   * Pass a static list via `staticSubnameResolver(["web.example.eth", ...])`.
   */
  subnameResolver?: SubnameResolver
  /**
   * ENS subgraph URL. Used by the default subgraph resolver when no custom
   * `subnameResolver` is provided.
   * Defaults to the public ENS subgraph on The Graph Network.
   */
  subgraphUrl?: string
  /**
   * Text record key prefix for the registrations array.
   * Defaults to "registrations" (reads "registrations[0]", "registrations[1]", etc.).
   */
  registrationsKey?: string
  /**
   * Text record key prefix for attestation lookups.
   * Defaults to "attestations" (reads "attestations[{CAIP-19}]").
   */
  attestationsKey?: string
}
