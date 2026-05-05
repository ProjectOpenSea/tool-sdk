import { createWellKnownHandler } from "@opensea/tool-sdk"
import { toCloudflareHandler } from "@opensea/tool-sdk/cloudflare"
import { toolConfig } from "./handler.js"
import { manifest } from "./manifest.js"

const worker = toCloudflareHandler(toolConfig)

export default {
  async fetch(
    request: Request,
    env: Record<string, string | undefined>,
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith("/.well-known/ai-tool/")) {
      return createWellKnownHandler(manifest, { env })(request)
    }

    return worker.fetch(request, env)
  },
}
