import type { Chain } from "viem"
import { ToolRegistryClient } from "./registry.js"

export interface CheckToolAccessOptions {
  /** Onchain tool ID to check access for. */
  toolId: bigint
  /** EVM account whose access is being checked. */
  account: `0x${string}`
  /** Chain where the registry is deployed. Defaults to Base. */
  chain?: Chain
  /** RPC URL for the staticcall. Defaults to the chain's public RPC. */
  rpcUrl?: string
  /**
   * Optional bytes forwarded as the `data` argument to the predicate. Most
   * predicates ignore this; supply it only when the configured predicate
   * documents a use for it.
   */
  data?: `0x${string}`
}

export interface CheckToolAccessResult {
  /** `false` if the predicate misbehaved (out of gas, malformed return). */
  ok: boolean
  /** `true` if the predicate granted access. */
  granted: boolean
}

/**
 * Client-side preview of whether `account` has access to a registered tool.
 * Mirrors the server-side `predicateGate` decision so frontends, CLIs, and
 * agents can gray out "Use Tool" affordances without first invoking the tool.
 *
 * Calls `IToolRegistry.tryHasAccess` via a viem staticcall. Open-access
 * tools (`accessPredicate == address(0)`) return `{ ok: true, granted: true }`.
 */
export async function checkToolAccess(
  opts: CheckToolAccessOptions,
): Promise<CheckToolAccessResult> {
  const registry = new ToolRegistryClient({
    chain: opts.chain,
    rpcUrl: opts.rpcUrl,
  })
  return registry.tryHasAccess(opts.toolId, opts.account, opts.data ?? "0x")
}
