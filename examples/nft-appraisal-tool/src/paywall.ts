import {
  defineToolPaywall,
  type GateMiddleware,
  paidPredicateGate,
} from "@opensea/tool-sdk"

/** Holder-tier price. Shared by the manifest pricing and the gate so they
 * can never drift. */
const HOLDER_AMOUNT_USDC = "0.01"
const FACILITATOR = "payai" as const

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
    amountUsdc: HOLDER_AMOUNT_USDC,
    facilitator: FACILITATOR,
  })
}

/**
 * Holder gate: a single `paidPredicateGate` that resolves the onchain
 * CHONK-ownership predicate and the $0.01 x402 payment in one 402 round trip
 * (2 requests instead of 3). The predicate is checked before the facilitator
 * settles, so non-holders get a 403 and no funds move.
 *
 * `operatorAddress` here is the payment recipient: `paidPredicateGate` uses it
 * as both the 402 `payTo` and the identity binding (the caller's `X-Payment`
 * `to` must match it), so it must equal the manifest pricing's `recipient`.
 */
export function buildHolderGates({
  toolId,
  rpcUrl,
  recipient,
}: {
  /** On-chain ToolRegistry tool ID (from the `ToolRegistered` event). */
  toolId: bigint
  /** Optional Base RPC override; defaults to viem's public RPC. */
  rpcUrl?: string
  /** Payment recipient; also the identity binding and 402 `payTo`. */
  recipient: `0x${string}`
}): GateMiddleware[] {
  return [
    paidPredicateGate({
      toolId,
      rpcUrl,
      operatorAddress: recipient,
      amountUsdc: HOLDER_AMOUNT_USDC,
      facilitator: FACILITATOR,
    }),
  ]
}
