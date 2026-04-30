import type { z } from "zod/v4"
import type { GateMiddleware, ToolContext } from "../../types.js"
import type { ToolManifest } from "../manifest/types.js"
import { ToolHandlerError } from "./error.js"

export interface ToolHandlerConfig<TIn, TOut> {
  manifest: ToolManifest
  inputSchema: z.ZodType<TIn>
  outputSchema: z.ZodType<TOut>
  gates?: GateMiddleware[]
  handler: (input: TIn, ctx: ToolContext) => Promise<TOut>
}

export function createToolHandler<TIn, TOut>(
  config: ToolHandlerConfig<TIn, TOut>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 },
        )
      }

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
        request,
      }

      if (config.gates) {
        for (const gate of config.gates) {
          const gateResponse = await gate.check(request, ctx)
          if (gateResponse) return gateResponse
        }
      }

      const output = await config.handler(inputResult.data, ctx)

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

      return Response.json(outputResult.data, { status: 200 })
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
