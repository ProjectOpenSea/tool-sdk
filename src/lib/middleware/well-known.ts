import type { ToolManifest } from "../manifest/types.js"
import { deriveSlug } from "../utils.js"

export function createWellKnownHandler(manifest: ToolManifest) {
  const slug = deriveSlug(manifest.name)
  const expectedPath = `/.well-known/ai-tool/${slug}.json`

  return (request: Request): Response => {
    const url = new URL(request.url)
    if (url.pathname !== expectedPath) {
      return Response.json(
        { error: "Not found" },
        { status: 404 },
      )
    }

    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
}
