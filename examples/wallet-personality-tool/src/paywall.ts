import {
  defineToolPaywall,
  type GateMiddleware,
  predicateGate,
} from "@opensea/tool-sdk"

/**
 * Public x402 paywall. Returns the manifest pricing entry and the gate from
 * the same definition so they can never drift apart. The SDK gate rejects
 * the zero address and common burn addresses; no extra handler-layer guard
 * needed.
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
 * Subscriber gate. Single onchain check via the `SubscriptionPredicate`
 * configured on the registered toolId. No paywall — holders call free.
 */
export function buildSubscriberGates({
  toolId,
  rpcUrl,
}: {
  /** On-chain ToolRegistry tool ID (from the `ToolRegistered` event). */
  toolId: bigint
  /** Optional Base RPC override; defaults to viem's public RPC. */
  rpcUrl?: string
}): GateMiddleware[] {
  return [predicateGate({ toolId, rpcUrl })]
}
