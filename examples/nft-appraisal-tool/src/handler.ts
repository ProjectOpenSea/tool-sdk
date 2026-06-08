import {
  createToolHandler,
  type Eip3009UsageReporterConfig,
  type GateMiddleware,
  type ManifestDefinition,
  ToolHandlerError,
} from "@opensea/tool-sdk"
import { z } from "zod/v4"
import { runAppraisal } from "./appraisal.js"
import { OpenSeaError } from "./opensea.js"
import { AppraisalSchema } from "./schemas.js"

const InputSchema = z.object({
  chain: z.string().min(1),
  contractAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x-prefixed 42-char address"),
  tokenId: z.string().regex(/^\d+$/, "must be a decimal string"),
})

export interface BuildToolHandlerOptions {
  manifest: ManifestDefinition
  /**
   * Ordered gate chain. For the public tier this is just the x402 gate;
   * the holder tier prepends a `predicateGate` so non-holders get a clean
   * 403 before being asked to pay. The x402 gate validates its own
   * recipient address (rejects the zero / burn addresses), so this layer
   * doesn't need to.
   */
  gates: GateMiddleware[]
  /**
   * Optional usage-reporting config. When set, the SDK reports each
   * successful invocation to OpenSea at the very end of the lifecycle
   * (fire-and-forget). For these paid tiers it reports the x402 payer plus
   * the settlement tx hash. Omitted in local/dev where no API key is set.
   */
  usageReporting?: Eip3009UsageReporterConfig
}

/**
 * Build the tool handler. OpenSea and LLM failures surface as 502
 * (`ToolHandlerError`) so callers who paid the x402 paywall get the
 * correct "we couldn't fulfill" status, not an opaque 500.
 */
export function buildToolHandler(opts: BuildToolHandlerOptions) {
  return createToolHandler({
    manifest: opts.manifest,
    inputSchema: InputSchema,
    outputSchema: AppraisalSchema,
    gates: opts.gates,
    usageReporting: opts.usageReporting,
    handler: async input => {
      try {
        return await runAppraisal({
          chain: input.chain,
          contractAddress: input.contractAddress,
          tokenId: input.tokenId,
        })
      } catch (err) {
        if (err instanceof OpenSeaError) {
          throw new ToolHandlerError(
            502,
            `OpenSea upstream error: ${err.message}`,
          )
        }
        // LLM call failures and any other pipeline errors are also "we
        // couldn't fulfill the paid request" — 502 fits better than 500.
        // Specifically: schema-validation-after-retry throws a plain Error;
        // `generateObject` itself throws AI_APICallError. Both should map
        // to 502.
        if (err instanceof Error) {
          throw new ToolHandlerError(
            502,
            `Appraisal pipeline error: ${err.message}`,
          )
        }
        throw err
      }
    },
  })
}
