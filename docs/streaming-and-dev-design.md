# Design: Streaming Output (#7) & `tool-sdk dev` (#9)

## Streaming Output (#7)

### Problem

`createToolHandler` currently buffers the full output, validates it, then returns a single JSON response. Long-running tools (LLM summarisation, large dataset processing) cannot send partial results.

### Proposed API

```ts
interface ToolHandlerConfig<TIn, TOut> {
  // ... existing fields ...
  stream?: {
    encoder: (chunk: TOut) => string   // serialise one chunk (default: JSON + newline)
    contentType?: string               // default: "application/x-ndjson"
  }
  handler: (input: TIn, ctx: ToolContext) => Promise<TOut> | AsyncIterable<TOut>
}
```

When `handler` returns an `AsyncIterable`, the SDK streams chunks using a `ReadableStream`. Each chunk is validated against `outputSchema` before being written. The response uses `Transfer-Encoding: chunked` with the configured content type.

Gate `settle()` hooks run after the stream completes (after the last chunk is flushed).

### Backward Compatibility

Returning a plain `Promise<TOut>` continues to work as today — no streaming overhead is added unless `handler` returns an async iterable.

### Effort Estimate

~2–3 days. Core streaming logic is straightforward; the main work is testing edge cases (client disconnect mid-stream, chunk validation failure, gate settlement timing) and updating adapters (Vercel's `res.send` vs native `ReadableStream`, Cloudflare's `TransformStream`).

---

## `tool-sdk dev` (#9)

### Problem

Developers test tools by deploying to Vercel/CF, editing env vars, and invoking via curl. There is no local dev loop with hot reload and a test UI.

### Proposed API

```bash
tool-sdk dev [--port 3456] [--manifest ./manifest.ts]
```

Starts a local HTTP server that:

1. Loads the manifest file using `jiti` (already a dependency) for TypeScript support.
2. Serves `GET /.well-known/ai-tool/<slug>.json` (the resolved manifest).
3. Proxies `POST /` to the tool handler with hot reload on file changes.
4. Serves a minimal HTML test page at `GET /` with a JSON input form, submit button, and response viewer.

### Implementation

- Use Node's built-in `http.createServer` (no new dependency).
- Use `fs.watch` for file-change detection to re-import the handler module.
- The test UI is a single inlined HTML string (no static assets to bundle).
- Environment variables are read from `.env` in the project root via a lightweight parser (or the existing `dotenv` if present).

### Effort Estimate

~3–4 days. Server scaffolding and `jiti` loading are quick; the test UI, hot-reload reliability across platforms, and CLI argument handling take the bulk of the time.
