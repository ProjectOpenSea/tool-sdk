import { type Chain, createPublicClient, decodeAbiParameters, http, zeroAddress } from "viem"
import { base } from "viem/chains"
import { IAccessPredicateABI } from "./abis.js"
import { ToolRegistryClient } from "./registry.js"

export interface CheckToolAccessOptions {
  /** Onchain tool ID to check access for. */
  toolId: bigint
  /** EVM account whose access is being checked. */
  account: `0x${string}`
  /** Chain where the registry is deployed. Defaults to Base. */
  chain?: Chain
  /** RPC URL for the staticcall. Defaults to the chain's public RPC. */
  rpcUrl?: string
  /**
   * Optional bytes forwarded as the `data` argument to the predicate. Most
   * predicates ignore this; supply it only when the configured predicate
   * documents a use for it.
   */
  data?: `0x${string}`
}

export interface CheckToolAccessResult {
  /** `false` if the predicate misbehaved (out of gas, malformed return). */
  ok: boolean
  /** `true` if the predicate granted access. */
  granted: boolean
}

/**
 * Client-side preview of whether `account` has access to a registered tool.
 * Mirrors the server-side `predicateGate` decision so frontends, CLIs, and
 * agents can gray out "Use Tool" affordances without first invoking the tool.
 *
 * Calls `IToolRegistry.tryHasAccess` via a viem staticcall. Open-access
 * tools (`accessPredicate == address(0)`) return `{ ok: true, granted: true }`.
 */
export async function checkToolAccess(
  opts: CheckToolAccessOptions,
): Promise<CheckToolAccessResult> {
  const registry = new ToolRegistryClient({
    chain: opts.chain,
    rpcUrl: opts.rpcUrl,
  })
  return registry.tryHasAccess(opts.toolId, opts.account, opts.data ?? "0x")
}

export interface DescribeToolAccessOptions {
  /** Onchain tool ID. */
  toolId: bigint
  /** Chain where the registry is deployed. Defaults to Base. */
  chain?: Chain
  /** RPC URL for the staticcall. Defaults to the chain's public RPC. */
  rpcUrl?: string
}

export interface AccessRequirementInfo {
  /** ERC-165–style 4-byte selector identifying the requirement type. */
  kind: `0x${string}`
  /** ABI-encoded payload whose layout is determined by `kind`. */
  data: `0x${string}`
  /** Human-readable hint (e.g. "Chonks on Base"). */
  label: string
}

export interface ToolAccessDescription {
  /** Whether the tool is open access (no predicate). */
  openAccess: boolean
  /** Address of the access predicate contract, if any. */
  predicateAddress: `0x${string}` | null
  /** Human-readable name of the predicate (from `name()`), if available. */
  predicateName: string | null
  /** Structured requirements from `getRequirements()`, if available. */
  requirements: AccessRequirementInfo[]
  /** 0 = AND, 1 = OR. How requirements combine. */
  logic: "AND" | "OR"
}

/**
 * Describes the access requirements for a registered tool in a structured
 * format suitable for UIs, CLIs, and agents.
 *
 * Reads the tool's predicate from the registry, then calls the predicate's
 * `name()` and `getRequirements(toolId)` to produce a machine-readable
 * description. If the predicate doesn't support those calls, the fields
 * degrade gracefully to `null` / empty arrays.
 */
export async function describeToolAccess(
  opts: DescribeToolAccessOptions,
): Promise<ToolAccessDescription> {
  const chain = opts.chain ?? base
  const registry = new ToolRegistryClient({ chain, rpcUrl: opts.rpcUrl })
  const config = await registry.getToolConfig(opts.toolId)

  if (config.accessPredicate === zeroAddress) {
    return {
      openAccess: true,
      predicateAddress: null,
      predicateName: null,
      requirements: [],
      logic: "AND",
    }
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(opts.rpcUrl),
  })

  let predicateName: string | null = null
  try {
    predicateName = await publicClient.readContract({
      address: config.accessPredicate,
      abi: IAccessPredicateABI,
      functionName: "name",
    })
  } catch {
    // Predicate doesn't implement name() — degrade gracefully
  }

  let requirements: AccessRequirementInfo[] = []
  let logic: "AND" | "OR" = "AND"
  try {
    const result = await publicClient.readContract({
      address: config.accessPredicate,
      abi: IAccessPredicateABI,
      functionName: "getRequirements",
      args: [opts.toolId],
    })
    requirements = result[0].map((r) => ({
      kind: r.kind,
      data: r.data,
      label: r.label,
    }))
    logic = result[1] === 0 ? "AND" : "OR"
  } catch {
    // Predicate doesn't implement getRequirements() — degrade gracefully
  }

  return {
    openAccess: false,
    predicateAddress: config.accessPredicate,
    predicateName,
    requirements,
    logic,
  }
}

const KNOWN_KINDS = {
  "0xbdf8c428": "erc721",
  "0xcb429230": "erc1155",
  "0x44387cc2": "subscription",
} as const

export type DecodedERC721Requirement = {
  type: "erc721"
  collection: `0x${string}`
}

export type DecodedERC1155Requirement = {
  type: "erc1155"
  collection: `0x${string}`
  tokenId: bigint
}

export type DecodedSubscriptionRequirement = {
  type: "subscription"
  collection: `0x${string}`
  minTier: number
}

export type DecodedUnknownRequirement = {
  type: "unknown"
  kind: `0x${string}`
  data: `0x${string}`
}

export type DecodedRequirement =
  | DecodedERC721Requirement
  | DecodedERC1155Requirement
  | DecodedSubscriptionRequirement
  | DecodedUnknownRequirement

/**
 * Decodes an `AccessRequirementInfo` into a typed object based on its `kind`.
 * Known kinds (ERC-721 holding, ERC-1155 holding, Subscription) are fully
 * decoded; unknown kinds are returned as-is with `type: "unknown"`.
 */
export function decodeRequirement(req: AccessRequirementInfo): DecodedRequirement {
  const kindKey = req.kind.slice(0, 10).toLowerCase() as keyof typeof KNOWN_KINDS
  const knownType = KNOWN_KINDS[kindKey]

  if (knownType === "erc721") {
    const [collection] = decodeAbiParameters(
      [{ type: "address" }],
      req.data,
    )
    return { type: "erc721", collection }
  }

  if (knownType === "erc1155") {
    const [collection, tokenId] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      req.data,
    )
    return { type: "erc1155", collection, tokenId }
  }

  if (knownType === "subscription") {
    const [collection, minTier] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint8" }],
      req.data,
    )
    return { type: "subscription", collection, minTier }
  }

  return { type: "unknown", kind: req.kind, data: req.data }
}
