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
  address: "0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1",
  chains: [1, 8453, 360, 2741],
}

export const ERC721_OWNER_PREDICATE: Deployment = {
  address: "0xc8721c9A776958FfFfEb602DA1b708bf1D318379",
  chains: [1, 8453, 360, 2741],
}

export const ERC1155_OWNER_PREDICATE: Deployment = {
  address: "0x77373Dc3c1AE9A1e937eF3e5E08F4807D47c7c11",
  chains: [1, 8453, 360, 2741],
}

export const SUBSCRIPTION_PREDICATE: Deployment = {
  address: "0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25",
  chains: [1, 8453, 360, 2741],
}

export const TRAIT_GATED_PREDICATE: Deployment = {
  address: "0x10abF07CfA34Bf22372C57f27e8bd9C2DCF93fA1",
  chains: [1, 8453, 360, 2741],
}

export const ERC20_BALANCE_PREDICATE: Deployment = {
  address: "0x1a834FC48B5f6e119c62C12a98b32137bCFA77cD",
  chains: [1, 8453, 360, 2741],
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
