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

export const ERC721_OWNER_PREDICATE: Deployment = {
  address: "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
  chains: [8453],
}

export const ERC1155_OWNER_PREDICATE: Deployment = {
  address: "0x4961A1bee290b48Aee8EAC04d38E965f3636F549",
  chains: [8453],
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
