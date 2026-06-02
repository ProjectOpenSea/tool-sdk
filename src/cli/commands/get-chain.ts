import { abstract as abstractChain, base, mainnet, shape } from "viem/chains"

export function getChain(network: string) {
  switch (network) {
    case "base":
      return base
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
