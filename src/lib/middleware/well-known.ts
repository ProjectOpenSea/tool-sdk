import type { ManifestDefinition } from "../manifest/index.js"
import { resolveManifest } from "../manifest/index.js"
import type { ToolManifest } from "../manifest/types.js"

export interface WellKnownHandlerOptions {
  /**
   * Environment bindings for resolving `EnvResolver` fields. On Node this
   * defaults to `process.env`; on Cloudflare Workers or Bun pass your
   * worker's `env` bindings explicitly.
   */
  env?: Record<string, string | undefined>
}

/**
 * Creates a handler that serves the tool manifest as JSON.
 *
 * Accepts either a resolved `ToolManifest` or an unresolved
 * `ManifestDefinition` (returned by `defineManifest`). When a definition is
 * passed, `resolveManifest(definition, env)` is called once on the first
 * request so that `EnvResolver` fields are evaluated at request time, not at
 * module-load time.
 *
 * **Routing:** This handler does not perform pathname matching — mount it at
 * the exact well-known route in your framework (e.g.
 * `app.get('/.well-known/ai-tool/my-tool.json', handler)`).
 */
export function createWellKnownHandler(
  manifestOrDefinition: ManifestDefinition | ToolManifest,
  options?: WellKnownHandlerOptions,
) {
  let resolved: ToolManifest | undefined

  return (_request: Request): Response => {
    if (!resolved) {
      const env =
        options?.env ??
        (globalThis.process?.env as Record<string, string | undefined>)
      if (!env) {
        throw new Error(
          "[tool-sdk] No env available. On non-Node runtimes (Cloudflare Workers, Bun), " +
            "pass { env } to createWellKnownHandler.",
        )
      }
      resolved = resolveManifest(
        manifestOrDefinition as ManifestDefinition,
        env,
      )
    }

    return new Response(JSON.stringify(resolved), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
}
