# Migrating an Existing Tool

This guide covers moving a tool between deployment targets — most commonly Vercel → Cloudflare Workers. The key insight: `@opensea/tool-sdk` uses a **factory pattern** where `createToolHandler`, `defineManifest`, and gate constructors are pure factories that return platform-agnostic objects. Only the thin runtime-specific entry adapter changes.

## Architecture: Pure Factories + Thin Adapters

```
┌──────────────────────────────────────────┐
│  src/manifest.ts     defineManifest()    │  ← pure, no runtime deps
│  src/handler.ts      createToolHandler() │  ← pure, no runtime deps
└──────────────┬───────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
  Vercel adapter   Cloudflare adapter
  api/index.ts     src/index.ts
  toVercelHandler  toCloudflareHandler
```

Your manifest, handler, input/output schemas, and gates live in shared `src/` files. The entry point is a one-liner adapter that wires the handler to the runtime.

## The Key Difference: Environment Threading

On **Vercel**, `process.env` is available at module-init time:

```typescript
// src/handler.ts — works on Vercel (and Express)
import { createToolHandler, payaiX402Gate } from "@opensea/tool-sdk"

const gate = payaiX402Gate({
  recipient: process.env.PAYOUT_ADDRESS!,  // ✅ available at import time
  amountUsdc: "0.01",
})

export const toolHandler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [gate],
  handler: async (input) => { /* ... */ },
})
```

On **Cloudflare Workers**, env is **not** available at module scope — it arrives as the second argument to `fetch(request, env)`:

```typescript
// src/index.ts — Cloudflare Workers entry
import { createWellKnownHandler } from "@opensea/tool-sdk"
import { toCloudflareHandler } from "@opensea/tool-sdk/cloudflare"
import { manifest } from "./manifest.js"
import { buildToolHandler } from "./handler.js"

const wellKnownHandler = createWellKnownHandler(manifest)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith("/.well-known/ai-tool/")) {
      return wellKnownHandler(request)
    }

    // Build the handler per-request with env values
    const toolHandler = buildToolHandler(env)
    return toolHandler(request)
  },
}
```

```typescript
// src/handler.ts — factory pattern for Cloudflare
import { createToolHandler, payaiX402Gate } from "@opensea/tool-sdk"
import { manifest } from "./manifest.js"

interface Env {
  PAYOUT_ADDRESS: string
}

export function buildToolHandler(env: Env) {
  const gate = payaiX402Gate({
    recipient: env.PAYOUT_ADDRESS,  // ✅ env threaded in at request time
    amountUsdc: "0.01",
  })

  return createToolHandler({
    manifest,
    inputSchema,
    outputSchema,
    gates: [gate],
    handler: async (input) => { /* ... */ },
  })
}
```

> **Performance note:** Constructing the handler on every request is cheap — `createToolHandler` does no I/O. If profiling shows it matters, cache the handler per unique env shape using a module-scoped `Map`.

## Migration Checklist: Vercel → Cloudflare Workers

1. **Scaffold the Cloudflare entry point.** Create `src/index.ts` with the `export default { fetch }` pattern shown above. Install `wrangler` and create a `wrangler.toml`.

2. **Convert env access to factory pattern.** Any code that reads `process.env` at module scope must move into a factory function that receives `env` as a parameter. This is the most common migration pain point.

3. **Update the adapter import.** Replace:
   ```typescript
   // Before (Vercel)
   import { toVercelHandler } from "@opensea/tool-sdk"
   export default toVercelHandler(toolHandler)
   ```
   with:
   ```typescript
   // After (Cloudflare)
   import { toCloudflareHandler } from "@opensea/tool-sdk/cloudflare"
   export default toCloudflareHandler(toolHandler)
   ```
   Or use the manual `fetch` entry point if you need env threading (see above).

4. **Move secrets to `wrangler.toml` / Workers dashboard.** Vercel env vars become Workers secrets (`wrangler secret put <NAME>`) or `[vars]` in `wrangler.toml` for non-sensitive values.

5. **Check duration limits.** Cloudflare Workers has a 30 s CPU time limit. If your handler does heavy computation, consider offloading to a Durable Object or queue.

6. **Test locally.** Run `wrangler dev` and verify your `/.well-known/ai-tool/<slug>.json` and tool endpoint both respond correctly.

7. **Update onchain metadata URI.** After deploying, update the `metadataURI` in the ToolRegistry if your endpoint URL changed.

## Migration Checklist: Cloudflare Workers → Vercel

The reverse migration is simpler — flatten the factory back to module-scope:

1. Replace the `buildToolHandler(env)` factory with a direct `createToolHandler` call that reads `process.env`.
2. Create `api/index.ts` with `toVercelHandler(toolHandler)`.
3. Move secrets to Vercel Environment Variables.
4. Remove `wrangler.toml`.

## Shared Code Stays Shared

Regardless of direction, these files should not change during migration:

- `src/manifest.ts` — manifest definition (pure data, no env access)
- Input/output Zod schemas
- Gate configurations (unless they read env, in which case they move into the factory)
- Test files (they test the handler directly, not the adapter)
