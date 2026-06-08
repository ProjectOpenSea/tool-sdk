import { type GateMiddleware, predicateGate } from "@opensea/tool-sdk"
import { mainnet } from "viem/chains"

/**
 * Free gate: predicate only, no x402. Verifies the caller's EIP-3009 auth,
 * then staticcalls ToolRegistry.tryHasAccess(toolId, caller).
 *
 * The tool is registered on Ethereum mainnet and the gating collection lives
 * there, so the access check must consult the mainnet ToolRegistry. The SDK's
 * predicateGate otherwise defaults to Base, so we pin chain + RPC to mainnet.
 * The EIP-3009 identity signature itself still rides on Base USDC (the caller
 * signs with `--chain base`); only the onchain access check runs on mainnet.
 */
export function buildGates({
  toolId,
  rpcUrl,
  operatorAddress,
}: {
  toolId: bigint
  rpcUrl?: string
  operatorAddress: `0x${string}`
}): GateMiddleware[] {
  return [
    predicateGate({
      toolId,
      chain: mainnet,
      rpcUrl: rpcUrl ?? "https://ethereum-rpc.publicnode.com",
      operatorAddress,
    }),
  ]
}
