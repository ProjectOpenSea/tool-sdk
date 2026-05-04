import type { ToolHandlerConfig } from "../handler/index.js"
import { createToolHandler } from "../handler/index.js"

interface CloudflareWorkerExportedHandler {
  fetch: (request: Request, env: Record<string, string | undefined>) => Promise<Response>
}

export function toCloudflareHandler<TIn, TOut>(
  config: Omit<ToolHandlerConfig<TIn, TOut>, "env">,
): CloudflareWorkerExportedHandler {
  return {
    fetch: (request, env) => {
      const handler = createToolHandler({ ...config, env })
      return handler(request)
    },
  }
}
