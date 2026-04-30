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

export interface ToolContext {
  callerAddress?: `0x${string}`
  gates: {
    nft?: { granted: boolean }
    predicate?: { granted: boolean }
    x402?: {
      paid: boolean
      /**
       * Transaction hash of the on-chain settlement, populated by the gate's
       * `settle()` after the facilitator confirms.
       */
      settlementTxHash?: string
    }
  }
  request: Request
}
