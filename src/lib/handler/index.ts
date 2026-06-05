import type { z } from "zod/v4"
import type {
  GateMiddleware,
  InvocationEvent,
  ToolContext,
} from "../../types.js"
import type { ManifestDefinition } from "../manifest/index.js"
import { resolveManifest } from "../manifest/index.js"
import type { Eip3009UsageReporterConfig } from "../usage/eip3009-reporter.js"
import { createEip3009UsageReporter } from "../usage/eip3009-reporter.js"
import { ToolHandlerError } from "./error.js"

export interface ToolHandlerConfig<TIn, TOut> {
  manifest: ManifestDefinition
  env?: Record<string, string | undefined>
  inputSchema: z.ZodType<TIn>
  outputSchema: z.ZodType<TOut>
  gates?: GateMiddleware[]
  handler: (input: TIn, ctx: ToolContext) => Promise<TOut>
  /**
   * Automatically reports tool usage to the OpenSea metrics endpoint.
   *
   * Fires as a fire-and-forget async call at the very end of the
   * handler lifecycle — after the response is built. Never blocks or
   * fails the tool call. Free invocations send a signed zero-value
   * EIP-3009 authorization; paid x402 invocations send the settlement
   * tx hash.
   */
  usageReporting?: Eip3009UsageReporterConfig
  /**
   * Called after the handler succeeds and output validates. Fires for
   * every successful invocation — paid or free. Use for custom
   * analytics or rate limiting. Errors are caught and logged.
   */
  onInvocation?: (event: InvocationEvent) => void | Promise<void>
}

export function createToolHandler<TIn, TOut>(
  config: ToolHandlerConfig<TIn, TOut>,
): (request: Request) => Promise<Response> {
  const usageReporter = config.usageReporting
    ? createEip3009UsageReporter(config.usageReporting)
    : undefined

  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        )
      }

      const resolvedManifest = resolveManifest(
        config.manifest,
        config.env ?? (globalThis.process?.env as Record<string, string | undefined> ?? {}),
      )

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        )
      }

      const inputResult = config.inputSchema.safeParse(body)
      if (!inputResult.success) {
        return Response.json(
          {
            error: "Invalid input",
            details: inputResult.error.issues,
          },
          { status: 400 },
        )
      }

      const ctx: ToolContext = {
        gates: {},
        manifest: resolvedManifest,
        request,
      }

      if (config.gates) {
        for (const gate of config.gates) {
          const gateResponse = await gate.check(request, ctx)
          if (gateResponse) return gateResponse
        }
      }

      const handlerStart = Date.now()
      const output = await config.handler(inputResult.data, ctx)
      const latencyMs = Date.now() - handlerStart

      const outputResult = config.outputSchema.safeParse(output)
      if (!outputResult.success) {
        console.error(
          "[tool-sdk] output schema validation failed:",
          outputResult.error,
        )
        return Response.json(
          { error: "Internal tool error" },
          { status: 500 },
        )
      }

      // Run gates' settle() hooks. These move money or record state. The
      // loop is awaited before the response is returned, so a slow gate
      // adds latency to every successful call (capped at the gate's own
      // timeout). Truly non-blocking settlement requires runtime-specific
      // primitives (`waitUntil`) that are not portable across the
      // runtimes this SDK targets. Errors do not change the response:
      // operators surface failed settlements via logs and replay them
      // out-of-band using the verified payment payload.
      if (config.gates) {
        for (const gate of config.gates) {
          if (gate.settle) {
            try {
              await gate.settle(ctx)
            } catch (err) {
              console.error("[tool-sdk] gate.settle failed:", err)
            }
          }
        }
      }

      const event: InvocationEvent = {
        callerAddress: ctx.callerAddress,
        agentAddress: ctx.agentAddress,
        callerAuthorization: ctx.callerAuthorization,
        paid: ctx.gates.x402?.paid ?? false,
        payer: ctx.gates.x402?.payer,
        settlementTxHash: ctx.gates.x402?.settlementTxHash,
        settlementChainId: ctx.gates.x402?.settlementChainId,
        toolName: resolvedManifest.name,
        latencyMs,
        timestamp: Date.now(),
      }

      if (config.onInvocation) {
        try {
          await config.onInvocation(event)
        } catch (err) {
          console.error("[tool-sdk] onInvocation failed:", err)
        }
      }

      const response = Response.json(outputResult.data, { status: 200 })

      if (usageReporter) {
        void usageReporter(event).catch((err) => {
          console.error("[tool-sdk] usageReporting failed:", err)
        })
      }

      return response
    } catch (error) {
      if (error instanceof ToolHandlerError) {
        console.error("[tool-sdk] tool handler error:", error)
        return Response.json(
          { error: error.message },
          { status: error.status },
        )
      }
      console.error("[tool-sdk] unhandled error in tool handler:", error)
      return Response.json(
        { error: "Internal tool error" },
        { status: 500 },
      )
    }
  }
}
