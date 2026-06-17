import type { Chain } from "viem"
import {
  abstract as abstractChain,
  base,
  baseSepolia,
  mainnet,
  shape,
} from "viem/chains"

export function getChain(network: string) {
  switch (network) {
    case "base":
      return base
    case "base-sepolia":
      return baseSepolia
    case "mainnet":
      return mainnet
    case "shape":
      return shape
    case "abstract":
      return abstractChain
    default:
      throw new Error(`Unsupported network: ${network}`)
  }
}

/**
 * Returns the default public RPC URL for a chain, derived from viem's
 * built-in chain definitions. Used as a fallback when the user has not
 * explicitly set RPC_URL or --rpc-url.
 */
export function defaultRpcUrl(chain: Chain): string {
  return chain.rpcUrls.default.http[0]
}
