# Migrating an existing tool

This guide covers moving a tool between deployment targets, most often from Vercel to Cloudflare Workers. `createToolHandler`, `defineManifest`, and the gate constructors are pure factories that return platform-agnostic objects, so only the small runtime-specific entry adapter changes.

## Architecture: pure factories and thin adapters

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

The manifest, handler, input and output schemas, and gates live in shared `src/` files. The entry point is a one-line adapter that connects the handler to the runtime.

## The main difference: passing env in

On **Vercel**, `process.env` is available at module-init time:

```typescript
// src/handler.ts: works on Vercel (and Express)
import { createToolHandler, payaiX402Gate } from "@opensea/tool-sdk"

const gate = payaiX402Gate({
  recipient: process.env.PAYOUT_ADDRESS!,  // available at import time
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

On **Cloudflare Workers**, env is **not** available at module scope. It arrives as the second argument to `fetch(request, env)`:

```typescript
// src/index.ts: Cloudflare Workers entry
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
// src/handler.ts: factory pattern for Cloudflare
import { createToolHandler, payaiX402Gate } from "@opensea/tool-sdk"
import { manifest } from "./manifest.js"

interface Env {
  PAYOUT_ADDRESS: string
}

export function buildToolHandler(env: Env) {
  const gate = payaiX402Gate({
    recipient: env.PAYOUT_ADDRESS,  // env passed in at request time
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

> Building the handler on every request is cheap, because `createToolHandler` does no I/O. If profiling shows a cost, cache one handler per distinct env in a module-scoped `Map`.

## Checklist: Vercel to Cloudflare Workers

1. **Scaffold the Cloudflare entry point.** Create `src/index.ts` with the `export default { fetch }` pattern shown above. Install `wrangler` and create a `wrangler.toml`.

2. **Move env access into a factory.** Code that reads `process.env` at module scope must move into a function that takes `env` as a parameter. This is where most migrations get stuck.

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
   Use the manual `fetch` entry point shown above if the handler needs env.

4. **Move secrets to Workers.** Vercel env vars become Workers secrets (`wrangler secret put <NAME>`), or `[vars]` in `wrangler.toml` for values that are not sensitive.

5. **Check duration limits.** Workers allow 30 s of CPU time. Move heavy computation to a Durable Object or a queue.

6. **Test locally.** Run `wrangler dev` and check that `/.well-known/ai-tool/<slug>.json` and the tool endpoint both respond.

7. **Update the onchain metadata URI.** If the endpoint URL changed, update `metadataURI` in the ToolRegistry after deploying.

## Checklist: Cloudflare Workers to Vercel

The reverse is simpler: move the factory body back to module scope.

1. Replace the `buildToolHandler(env)` factory with a direct `createToolHandler` call that reads `process.env`.
2. Create `api/index.ts` with `toVercelHandler(toolHandler)`.
3. Move secrets to Vercel Environment Variables.
4. Remove `wrangler.toml`.

## Shared code stays the same

In either direction, these should not change:

- `src/manifest.ts`, the manifest definition (pure data, no env access)
- Input and output Zod schemas
- Gate configurations, unless they read env (then they move into the factory)
- Tests, since they exercise the handler rather than the adapter
