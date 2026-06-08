import {
  type Eip3009UsageReporterConfig,
  TOOL_REGISTRY,
} from "@opensea/tool-sdk"

/**
 * Base mainnet — where this tool is registered on `ToolRegistry` v0.2 and
 * where x402 settlements occur.
 */
const TOOL_CHAIN_ID = 8453

/**
 * Build the `usageReporting` config for a tool tier (its ERC-8257 composite
 * key is `TOOL_CHAIN_ID` + the canonical registry address + the tier's onchain
 * id). The SDK reports the verified caller automatically — for these paid
 * tiers, the x402 payer and settlement tx hash. No wallet or signing is
 * involved; the OpenSea API key authenticates this service as the reporter.
 */
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
