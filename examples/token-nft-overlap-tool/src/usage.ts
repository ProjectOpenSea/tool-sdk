import {
  type Eip3009UsageReporterConfig,
  TOOL_REGISTRY,
} from "@opensea/tool-sdk"

/**
 * Ethereum mainnet: where this tool is registered on `ToolRegistry` and where
 * its ERC-721 access gate is enforced. The tool is free, so there is no x402
 * settlement; each successful invocation is attributed via the caller's
 * EIP-3009 authorization (the SDK forwards the caller's original signature).
 *
 * Note the EIP-3009 identity signature itself rides on Base USDC (chain 8453),
 * carried inside the authorization payload, while `toolChainId` is the chain
 * the tool is registered on (mainnet). The SDK reports the verified caller
 * automatically; no wallet or signing happens here, and the OpenSea API key
 * authenticates this service as the reporter.
 */
const TOOL_CHAIN_ID = 1

export function buildUsageReporting(opts: {
  apiKey: string
  toolOnchainId: number
}): Eip3009UsageReporterConfig {
  return {
    chainId: TOOL_CHAIN_ID,
    toolChainId: TOOL_CHAIN_ID,
    toolRegistryAddress: TOOL_REGISTRY.address as `0x${string}`,
    toolOnchainId: opts.toolOnchainId,
    apiKey: opts.apiKey,
  }
}
