import type { Chain } from "viem"
import { defineChain } from "viem"
import {
  abstract as abstractChain,
  base,
  baseSepolia,
  mainnet,
  shape,
} from "viem/chains"

/**
 * Monad mainnet, mirroring viem's definition. The pinned viem version
 * predates Monad mainnet — replace with `import { monad } from "viem/chains"`
 * once viem is upgraded past 2.38.
 */
const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz"],
      webSocket: ["wss://rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://monadscan.com",
      apiUrl: "https://api.etherscan.io/v2/api?chainid=143",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 9248132,
    },
  },
})

/**
 * Robinhood Chain mainnet. Not yet in the pinned viem version — replace with
 * `import { robinhoodChain } from "viem/chains"` once viem ships a definition.
 */
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Blockscout Explorer",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
})

/** Help text for the `--network` CLI option, shared across commands. */
export const NETWORK_OPTION_DESCRIPTION =
  "Network: base, mainnet, shape, abstract, monad, or robinhood"

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
    case "monad":
      return monad
    case "robinhood":
      return robinhood
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
