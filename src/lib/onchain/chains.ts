/**
 * Canonical addresses live in packages/tool-registry/README.md.
 * Update both files together after every new deploy.
 */

/** Onchain deployment of a contract addressed via deterministic CREATE2. */
export type Deployment = {
  /** Canonical CREATE2 address — identical on every EVM-equivalent chain. */
  address: `0x${string}`
  /** Chain IDs where the canonical address has been deployed. */
  chains: readonly number[]
  /**
   * Per-chain overrides for non-EVM-equivalent chains where the canonical
   * CREATE2 address can't be reached. Rare; most deployments have none.
   */
  overrides?: Readonly<Record<number, `0x${string}`>>
}

export const TOOL_REGISTRY: Deployment = {
  address: "0x7291BbFbC368C2D478eCe1eA30de31F612a34856",
  chains: [8453],
}

/**
 * v0.2 ERC721OwnerPredicate — supports IAccessPredicate interfaceId 0xbdf9dc18
 * (hasAccess + name + getRequirements). Accepted by v0.2+ registries only.
 */
export const ERC721_OWNER_PREDICATE: Deployment = {
  address: "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769",
  chains: [8453],
}

/**
 * v0.1 ERC721OwnerPredicate — supports IAccessPredicate interfaceId 0xa11ea958
 * (hasAccess + name only, pre-getRequirements). Required by the live v0.1
 * registry on Base which validates predicates via supportsInterface(0xa11ea958).
 */
export const ERC721_OWNER_PREDICATE_V1: Deployment = {
  address: "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
  chains: [8453],
}

/**
 * v0.2 ERC1155OwnerPredicate — supports IAccessPredicate interfaceId 0xbdf9dc18.
 * Accepted by v0.2+ registries only.
 */
export const ERC1155_OWNER_PREDICATE: Deployment = {
  address: "0xc179b9d4D9B7ffe0CdA608134729f72003380A7e",
  chains: [8453],
}

/**
 * delegate.xyz DelegateRegistry V2. Deployed at the same deterministic address
 * on 30+ EVM chains.
 * @see https://docs.delegate.xyz/technical-documentation/delegate-registry/contract-addresses
 */
export const DELEGATE_REGISTRY: Deployment = {
  address: "0x00000000000000447e69651d841bD8D104Bed493",
  chains: [1, 8453, 42161, 10, 137],
}

/** Resolve a deployment to the address active on a given chain. */
export function deploymentAddress(
  d: Deployment,
  chainId: number,
): `0x${string}` | undefined {
  return (
    d.overrides?.[chainId] ??
    (d.chains.includes(chainId) ? d.address : undefined)
  )
}

/**
 * Registry-version-aware predicate resolution.
 *
 * The live v0.1 registry on Base validates predicates via
 * `supportsInterface(0xa11ea958)` (the v0.1 IAccessPredicate interfaceId:
 * hasAccess + name). The v0.2 predicates only claim `0xbdf9dc18`
 * (hasAccess + name + getRequirements), so the v0.1 registry rejects them.
 *
 * This mapping ensures the SDK picks the predicate version that matches
 * the deployed registry version.
 */
const VERSIONED_PREDICATES: Record<
  string,
  { erc721: Deployment; erc1155: Deployment }
> = {
  "0.1": {
    erc721: ERC721_OWNER_PREDICATE_V1,
    erc1155: ERC1155_OWNER_PREDICATE, // no v0.1 ERC1155 predicate deployed
  },
  "0.2": {
    erc721: ERC721_OWNER_PREDICATE,
    erc1155: ERC1155_OWNER_PREDICATE,
  },
}

export type PredicateKind = "erc721" | "erc1155"

/**
 * Returns the predicate deployment matching a given registry version.
 * Falls back to the v0.2 deployment if the version is unrecognized.
 */
export function getPredicateForRegistryVersion(
  registryVersion: string,
  kind: PredicateKind,
): Deployment {
  const entry = VERSIONED_PREDICATES[registryVersion]
  if (entry) return entry[kind]
  console.warn(
    `[tool-sdk] Unknown registry version "${registryVersion}", falling back to v0.2 predicate`,
  )
  return VERSIONED_PREDICATES["0.2"][kind]
}
