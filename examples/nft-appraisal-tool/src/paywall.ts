import {
  defineToolPaywall,
  type GateMiddleware,
  predicateGate,
} from "@opensea/tool-sdk"

/**
 * Single source of truth for the public x402 paywall config. Returns both
 * the manifest pricing entry and the gate, so they can never drift apart.
 * The SDK gate also rejects the zero address and common burn addresses, so
 * we don't need our own guard at the handler layer.
 */
export function buildPublicPaywall({
  recipient,
}: {
  recipient: `0x${string}`
}) {
  return defineToolPaywall({
    recipient,
    amountUsdc: "0.05",
    facilitator: "payai",
  })
}

/**
 * Discounted paywall for CHONK holders on Base. Charges $0.01 USDC via
 * x402. Returns the pricing array for the holder manifest and the gate.
 * Note: this gate alone does NOT enforce CHONK ownership — it only
 * collects the discounted payment. Pair with `buildHolderGates(...)` to
 * stack the onchain predicate gate in front for the full holder flow.
 *
 * Split this way so the holder manifest URL can render without
 * `HOLDER_TOOL_ID` (the manifest's pricing doesn't depend on the toolId,
 * only the gate does). Otherwise registering the holder tool would be a
 * chicken-and-egg: register needs a live manifest URL, but the manifest
 * needs the toolId from registration.
 */
export function buildHolderPaywall({
  recipient,
}: {
  recipient: `0x${string}`
}) {
  return defineToolPaywall({
    recipient,
    amountUsdc: "0.01",
    facilitator: "payai",
  })
}

/**
 * Compose the holder gate chain: `predicateGate` first (so non-holders
 * get a clean 403 before being asked to pay), then the x402 paywall gate.
 * `predicateGate` verifies SIWE auth and asks the onchain `ToolRegistry`
 * whether the caller satisfies the tool's registered access predicate.
 */
export function buildHolderGates(
  paywall: ReturnType<typeof buildHolderPaywall>,
  {
    toolId,
    rpcUrl,
  }: {
    /** On-chain ToolRegistry tool ID (from the `ToolRegistered` event). */
    toolId: bigint
    /** Optional Base RPC override; defaults to viem's public RPC. */
    rpcUrl?: string
  },
): GateMiddleware[] {
  return [predicateGate({ toolId, rpcUrl }), paywall.gate]
}
