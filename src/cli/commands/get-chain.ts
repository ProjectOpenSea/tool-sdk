import { base, mainnet } from "viem/chains"

export function getChain(network: string) {
  switch (network) {
    case "base":
      return base
    case "mainnet":
      return mainnet
    default:
      throw new Error(`Unsupported network: ${network}`)
  }
}
