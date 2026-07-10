import type { z } from "zod/v4"
import type {
  GateMiddleware,
  InvocationEvent,
  ToolContext,
} from "../../types.js"
import { buildSettlementResponseHeader } from "../client/x402-payment.js"
import type { ManifestDefinition } from "../manifest/index.js"
import { resolveManifest } from "../manifest/index.js"
import type { Eip3009UsageReporterConfig } from "../usage/eip3009-reporter.js"
import { createEip3009UsageReporter } from "../usage/eip3009-reporter.js"
import { ToolHandlerError } from "./error.js"

type WaitUntil = (promise: Promise<unknown>) => void

/**
 * Best-effort detection of a platform "keep-alive after response" primitive,
 * so fire-and-forget usage reports fire reliably without the tool author
 * wiring anything. Returns `undefined` when none is available (the caller
 * then awaits the report instead).
 *
 * Vercel populates a request-context global (the same one `@vercel/functions`
 * reads) holding a `waitUntil`. We read it directly to avoid a hard dependency
 * on `@vercel/functions`. Cloudflare's `ctx.waitUntil` is per-request and is
 * wired by `toCloudflareHandler` (passed via the `waitUntil` config option),
 * so it isn't detected here.
 *
 * Reading a global symbol is an accepted, bounded risk: anything could shadow
 * it, so we only trust it when it resolves to a callable `waitUntil` (the
 * `typeof === "function"` guard below) and otherwise fall back to awaiting the
 * report. The exposure is no worse than depending on `@vercel/functions`, which
 * reads the same global.
 */
function detectPlatformWaitUntil(): WaitUntil | undefined {
  try {
    const store = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@vercel/request-context")
    ] as { get?: () => { waitUntil?: WaitUntil } | undefined } | undefined
    const ctx = store?.get?.()
    if (typeof ctx?.waitUntil === "function") {
      // Call through `ctx` to preserve `this` binding.
      return promise => ctx.waitUntil?.(promise)
    }
  } catch {
    // Detection is best-effort; fall back to awaiting the report.
  }
  return undefined
}

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
  /**
   * Platform "keep-alive after response" primitive (e.g. Vercel/Cloudflare
   * `waitUntil`). When available, the fire-and-forget usage report is
   * registered through it and the response is returned without awaiting the
   * report — so reporting never adds latency and a function freeze in the
   * report window can't leave a paid caller charged with no result.
   *
   * Usually you don't set this: it's auto-detected from the Vercel request
   * context, and `toCloudflareHandler` wires `ctx.waitUntil` for you. Pass it
   * explicitly only to override detection or to support another runtime. When
   * no `waitUntil` is available (long-running servers, or serverless without
   * it), the report is awaited instead so it still fires before the freeze.
   */
  waitUntil?: (promise: Promise<unknown>) => void
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
        return Response.json({ error: "Method not allowed" }, { status: 405 })
      }

      const resolvedManifest = resolveManifest(
        config.manifest,
        config.env ??
          (globalThis.process?.env as Record<string, string | undefined>) ??
          {},
      )

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 })
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
        return Response.json({ error: "Internal tool error" }, { status: 500 })
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

      // Fire the usage report. The reporter has its own AbortController
      // timeout (default 5s) and never throws; the catch is belt-and-suspenders.
      //
      // With a platform `waitUntil` (auto-detected, or supplied via config /
      // `toCloudflareHandler`), register the report as keep-alive-after-response
      // work and return immediately — reporting adds no latency, and because the
      // response flushes before the report runs, a freeze in the report window
      // can't leave a paid caller charged with no result. Without `waitUntil`
      // (long-running servers, or serverless lacking it), await instead: on a
      // frozen runtime a fire-and-forget report would be killed at flush and
      // never arrive.
      if (usageReporter) {
        const reportPromise = usageReporter(event).catch(err => {
          console.error("[tool-sdk] usageReporting failed:", err)
        })
        const waitUntil = config.waitUntil ?? detectPlatformWaitUntil()
        if (waitUntil) {
          waitUntil(reportPromise)
        } else {
          await reportPromise
        }
      }

      // When the call was paid and settled onchain, echo the settlement tx
      // back to the caller in the x402 settlement-response header. This lets
      // caller-side usage reporting (and any other x402 client) read the tx
      // hash from the response — without it, `extractSettlementTxHash` finds
      // nothing and a caller's `--report-usage` silently no-ops.
      const settlementTxHash = ctx.gates.x402?.settlementTxHash
      const responseInit: ResponseInit = { status: 200 }
      if (settlementTxHash) {
        // v2 requests arrive with `PAYMENT-SIGNATURE`; v1 with `X-PAYMENT`.
        const x402Version = request.headers.has("PAYMENT-SIGNATURE") ? 2 : 1
        const { name, value } = buildSettlementResponseHeader({
          x402Version,
          transaction: settlementTxHash,
          payer: ctx.gates.x402?.payer,
        })
        responseInit.headers = { [name]: value }
      }

      return Response.json(outputResult.data, responseInit)
    } catch (error) {
      if (error instanceof ToolHandlerError) {
        console.error("[tool-sdk] tool handler error:", error)
        return Response.json({ error: error.message }, { status: error.status })
      }
      console.error("[tool-sdk] unhandled error in tool handler:", error)
      return Response.json({ error: "Internal tool error" }, { status: 500 })
    }
  }
}
