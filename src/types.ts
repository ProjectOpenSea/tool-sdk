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
  paid: boolean
  payer?: string
  settlementTxHash?: string
  /** Resolved tool name from the manifest, used to derive tool_slug. */
  toolName?: string
  latencyMs: number
  timestamp: number
}

export interface ToolContext {
  callerAddress?: `0x${string}`
  /** When a delegated agent call is verified, this holds the agent's address. */
  agentAddress?: `0x${string}`
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
    }
  }
  manifest: import("./lib/manifest/types.js").ToolManifest
  request: Request
}
