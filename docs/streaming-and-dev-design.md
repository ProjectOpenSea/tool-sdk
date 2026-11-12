# Design: streaming output (#7) and `tool-sdk dev` (#9)

## Streaming output (#7)

### Problem

`createToolHandler` buffers the full output, validates it, then returns one JSON response. Long-running tools (LLM summarization, large dataset processing) cannot send partial results.

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

When `handler` returns an `AsyncIterable`, the SDK streams chunks through a `ReadableStream`, validating each chunk against `outputSchema` before writing it. The response uses `Transfer-Encoding: chunked` with the configured content type.

Gate `settle()` hooks run after the last chunk is flushed.

### Backward compatibility

Returning a plain `Promise<TOut>` works as it does today. Streaming adds no overhead unless `handler` returns an async iterable.

### Effort estimate

About 2 to 3 days. The streaming logic is simple. Most of the time goes to edge-case tests (client disconnect mid-stream, chunk validation failure, gate settlement timing) and adapter updates (Vercel's `res.send` vs native `ReadableStream`, Cloudflare's `TransformStream`).

---

## `tool-sdk dev` (#9)

### Problem

Developers test tools by deploying to Vercel or Cloudflare, editing env vars, and calling the endpoint with curl. There is no local loop with hot reload and a test UI.

### Proposed API

```bash
tool-sdk dev [--port 3456] [--manifest ./manifest.ts]
```

Starts a local HTTP server that:

1. Loads the manifest with `jiti` (already a dependency) for TypeScript support.
2. Serves `GET /.well-known/ai-tool/<slug>.json` (the resolved manifest).
3. Proxies `POST /` to the tool handler, reloading on file changes.
4. Serves a minimal HTML test page at `GET /`: a JSON input form, a submit button, and a response viewer.

### Implementation

- Node's built-in `http.createServer`, so no new dependency.
- `fs.watch` detects file changes and re-imports the handler module.
- The test UI is one inlined HTML string, with no static assets to bundle.
- Environment variables come from `.env` in the project root, read by a small parser (or `dotenv` if the project already has it).

### Effort estimate

About 3 to 4 days. Server scaffolding and `jiti` loading are quick. The test UI, reliable hot reload across platforms, and CLI argument handling take most of the time.
