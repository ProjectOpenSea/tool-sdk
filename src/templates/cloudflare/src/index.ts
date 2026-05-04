import { createWellKnownHandler, resolveManifest } from "@opensea/tool-sdk"
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
      const resolved = resolveManifest(manifest, env)
      return createWellKnownHandler(resolved)(request)
    }

    return worker.fetch(request, env)
  },
}
