import {
  type Chain,
  createPublicClient,
  decodeAbiParameters,
  http,
  zeroAddress,
} from "viem"
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
    const rawName = await publicClient.readContract({
      address: config.accessPredicate,
      abi: IAccessPredicateABI,
      functionName: "name",
    })
    if (utf8ByteLength(rawName) <= MAX_NAME_BYTES) {
      predicateName = rawName
    }
    // Over-cap name() is treated as if the contract did not implement the
    // function, per ERC §Predicate Introspection Hardening.
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
    requirements = boundRequirements(result[0])
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

/**
 * Consumer-side ceilings on `getRequirements()` return values, mirroring the
 * onchain caps from ERC-8257 §Predicate Introspection Hardening. The SDK
 * enforces these defensively against arbitrary predicate code so a malicious
 * predicate cannot grief discovery surfaces with megabyte-scale returns.
 */
const MAX_REQUIREMENTS_ENTRIES = 256
const MAX_REQUIREMENT_DATA_BYTES = 4096
const MAX_REQUIREMENT_LABEL_BYTES = 256
const MAX_NAME_BYTES = 256

/**
 * Sentinel `kind` substituted for an over-cap requirement entry, per the ERC's
 * §Rationale > "getRequirements is advisory; hasAccess is the source of truth".
 */
const SENTINEL_KIND = "0x00000000" as `0x${string}`

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function hexByteLength(hex: `0x${string}`): number {
  return Math.max(0, (hex.length - 2) / 2)
}

function boundRequirements(
  raw: readonly { kind: `0x${string}`; data: `0x${string}`; label: string }[],
): AccessRequirementInfo[] {
  // Length cap: a predicate returning more than the cap is grossly
  // non-conformant; fail closed rather than truncate so consumers don't
  // silently inspect a subset.
  if (raw.length > MAX_REQUIREMENTS_ENTRIES) return []

  return raw.map(r => {
    if (
      hexByteLength(r.data) > MAX_REQUIREMENT_DATA_BYTES ||
      utf8ByteLength(r.label) > MAX_REQUIREMENT_LABEL_BYTES
    ) {
      return { kind: SENTINEL_KIND, data: "0x", label: "" }
    }
    return { kind: r.kind, data: r.data, label: r.label }
  })
}

export const ERC721_KIND = "0xbdf8c428" as const
export const ERC1155_KIND = "0xcb429230" as const
export const SUBSCRIPTION_KIND = "0x44387cc2" as const
export const ERC7496_TRAIT_KIND = "0x37d8dc22" as const
export const ERC20_BALANCE_KIND = "0x812b02ee" as const
export const WALLET_STATE_ATTESTATION_KIND = "0x7a111640" as const

const KNOWN_KINDS = {
  [ERC721_KIND]: "erc721",
  [ERC1155_KIND]: "erc1155",
  [SUBSCRIPTION_KIND]: "subscription",
  [ERC7496_TRAIT_KIND]: "erc7496Trait",
  [ERC20_BALANCE_KIND]: "erc20Balance",
  [WALLET_STATE_ATTESTATION_KIND]: "walletStateAttestation",
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

export type DecodedERC7496TraitRequirement = {
  type: "erc7496Trait"
  collection: `0x${string}`
  traitsContract: `0x${string}`
  traitKey: `0x${string}`
  allowedValues: readonly `0x${string}`[]
}

export type DecodedERC20BalanceRequirement = {
  type: "erc20Balance"
  token: `0x${string}`
  minBalance: bigint
}

export type DecodedWalletStateAttestationRequirement = {
  type: "walletStateAttestation"
  issuerJwksUri: string
  conditionHash: `0x${string}`
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
  | DecodedERC7496TraitRequirement
  | DecodedERC20BalanceRequirement
  | DecodedWalletStateAttestationRequirement
  | DecodedUnknownRequirement

/**
 * Decodes an `AccessRequirementInfo` into a typed object based on its `kind`.
 * Known kinds (ERC-721 holding, ERC-1155 holding, Subscription) are fully
 * decoded; unknown kinds are returned as-is with `type: "unknown"`.
 */
export function decodeRequirement(
  req: AccessRequirementInfo,
): DecodedRequirement {
  const kindKey = req.kind
    .slice(0, 10)
    .toLowerCase() as keyof typeof KNOWN_KINDS
  const knownType = KNOWN_KINDS[kindKey]

  if (knownType === "erc721") {
    const [collection] = decodeAbiParameters([{ type: "address" }], req.data)
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

  if (knownType === "erc7496Trait") {
    const [collection, traitsContract, traitKey, allowedValues] =
      decodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "bytes32" },
          { type: "bytes32[]" },
        ],
        req.data,
      )
    return {
      type: "erc7496Trait",
      collection,
      traitsContract,
      traitKey,
      allowedValues,
    }
  }

  if (knownType === "erc20Balance") {
    const [token, minBalance] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      req.data,
    )
    return { type: "erc20Balance", token, minBalance }
  }

  if (knownType === "walletStateAttestation") {
    const [issuerJwksUri, conditionHash] = decodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      req.data,
    )
    return { type: "walletStateAttestation", issuerJwksUri, conditionHash }
  }

  return { type: "unknown", kind: req.kind, data: req.data }
}
