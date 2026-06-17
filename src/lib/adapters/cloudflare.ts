import type { ToolHandlerConfig } from "../handler/index.js"
import { createToolHandler } from "../handler/index.js"

/** Minimal shape of the Cloudflare Workers `ExecutionContext`. */
interface CloudflareExecutionContext {
  waitUntil?: (promise: Promise<unknown>) => void
}

interface CloudflareWorkerExportedHandler {
  fetch: (
    request: Request,
    env: Record<string, string | undefined>,
    ctx?: CloudflareExecutionContext,
  ) => Promise<Response>
}

export function toCloudflareHandler<TIn, TOut>(
  config: Omit<ToolHandlerConfig<TIn, TOut>, "env">,
): CloudflareWorkerExportedHandler {
  return {
    fetch: (request, env, ctx) => {
      // Wire the per-request `ctx.waitUntil` so the fire-and-forget usage
      // report runs as keep-alive-after-response work rather than blocking the
      // response (or being killed at flush). An explicit `config.waitUntil`
      // still wins.
      const waitUntil =
        config.waitUntil ??
        (ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined)
      const handler = createToolHandler({ ...config, env, waitUntil })
      return handler(request)
    },
  }
}
