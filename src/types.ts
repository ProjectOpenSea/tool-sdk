export type GateMiddleware = {
  check(request: Request, ctx: Partial<ToolContext>): Promise<Response | null>
  /**
   * Optional post-handler hook called after the user handler succeeds and the
   * output validates against the schema. Gates that move money (like x402)
   * settle here. The hook runs synchronously before the response is returned,
   * so a slow `settle()` adds latency to the response. A `settle()` that
   * throws is logged but does not change the response.
   */
  settle?(ctx: ToolContext): Promise<void>
}

export interface InvocationEvent {
  callerAddress?: `0x${string}`
  agentAddress?: `0x${string}`
  /**
   * The caller's original verified EIP-3009 zero-value authorization, when an
   * auth gate (e.g. `predicateGate`) recovered one from the request. Carried
   * through so usage reporting can forward the caller's own signature instead
   * of re-signing server-side.
   */
  callerAuthorization?: import("./lib/usage/eip3009-auth.js").ZeroValueAuthorization
  paid: boolean
  payer?: string
  settlementTxHash?: string
  /** Chain ID where the x402 settlement tx was mined. */
  settlementChainId?: number
  /** Resolved tool name from the manifest. */
  toolName?: string
  latencyMs: number
  timestamp: number
}

export interface ToolContext {
  callerAddress?: `0x${string}`
  /** When a delegated agent call is verified, this holds the agent's address. */
  agentAddress?: `0x${string}`
  /**
   * The caller's verified EIP-3009 zero-value authorization, stashed by an
   * auth gate so downstream usage reporting can forward the caller's own
   * signature rather than re-signing server-side.
   */
  callerAuthorization?: import("./lib/usage/eip3009-auth.js").ZeroValueAuthorization
  gates: {
    predicate?: { granted: boolean }
    x402?: {
      paid: boolean
      /** Payer address returned by the facilitator's /verify response. */
      payer?: string
      /**
       * Transaction hash of the onchain settlement, populated by the gate's
       * `settle()` after the facilitator confirms.
       */
      settlementTxHash?: string
      /** Chain ID where the settlement transaction was mined. */
      settlementChainId?: number
    }
  }
  manifest: import("./lib/manifest/types.js").ToolManifest
  request: Request
}
