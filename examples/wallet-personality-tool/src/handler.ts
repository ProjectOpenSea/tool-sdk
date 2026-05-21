import {
  createToolHandler,
  type GateMiddleware,
  type ManifestDefinition,
  ToolHandlerError,
} from "@opensea/tool-sdk"
import { buildWalletDigest } from "./digest.js"
import { assembleMarkdown } from "./markdown.js"
import { OpenSeaError } from "./opensea.js"
import { synthesizePersonality } from "./personality.js"
import { InputSchema, type ResponsePayload, ResponseSchema } from "./schemas.js"

export interface BuildToolHandlerOptions {
  manifest: ManifestDefinition
  /**
   * Ordered gate chain. For the public tier this is just the x402 paywall;
   * the subscriber tier uses `predicateGate` (no paywall). Tests can pass
   * a single pass-through stub.
   */
  gates: GateMiddleware[]
}

export function buildToolHandler(opts: BuildToolHandlerOptions) {
  return createToolHandler({
    manifest: opts.manifest,
    inputSchema: InputSchema,
    outputSchema: ResponseSchema,
    gates: opts.gates,
    handler: async (input, ctx): Promise<ResponsePayload> => {
      const target = input.targetAddress ?? ctx.callerAddress
      if (!target) {
        // predicateGate / paywall set callerAddress on success; this is a
        // safety net for gate swaps that don't.
        throw new ToolHandlerError(
          400,
          "Could not resolve targetAddress (no input + no caller).",
        )
      }
      try {
        const digest = await buildWalletDigest(target)
        const personality = await synthesizePersonality(digest)
        const generatedAt = new Date().toISOString()
        const markdown = assembleMarkdown(personality, digest, generatedAt)
        return {
          ...personality,
          targetAddress: target,
          generatedAt,
          markdown,
        }
      } catch (err) {
        if (err instanceof OpenSeaError) {
          throw new ToolHandlerError(
            502,
            `OpenSea upstream error: ${err.message}`,
          )
        }
        if (err instanceof Error) {
          throw new ToolHandlerError(
            502,
            `Personality synthesis error: ${err.message}`,
          )
        }
        throw err
      }
    },
  })
}
