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
  address: "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769",
  chains: [8453],
}

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
