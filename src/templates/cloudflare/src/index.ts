import { createWellKnownHandler } from "@opensea/tool-sdk"
import { toolHandler } from "./handler.js"
import { manifest } from "./manifest.js"

const wellKnownHandler = createWellKnownHandler(manifest)

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith("/.well-known/ai-tool/")) {
      return wellKnownHandler(request)
    }

    return toolHandler(request)
  },
}
