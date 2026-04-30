# @opensea/tool-sdk

SDK and CLI for building [ERC-XXXX](../tool-registry/eip-xxxx-tool-registry.md) compliant AI agent tools. Provides manifest validation, onchain registration, gating middleware, framework adapters, and project scaffolding.

## Quick Start

```bash
# 1. Scaffold a new tool project
npx @opensea/tool-sdk init my-tool

# 2. Implement your tool logic
cd my-tool && npm install
# Edit src/handler.ts
# NOTE: If your project sits adjacent to a pnpm workspace, use
# pnpm install --ignore-workspace to prevent pnpm from walking
# up to the parent workspace.

# 3. Deploy
npx vercel  # or wrangler deploy, etc.

# 4. Register onchain
npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base
```

## CLI Reference

### `init [name]`

Scaffold a new ERC-XXXX tool project with interactive prompts.

```bash
npx @opensea/tool-sdk init my-tool
npx @opensea/tool-sdk init my-tool --no-interactive  # CI mode
```

Supports Vercel, Cloudflare Workers, and Express templates.

### `validate [path]`

Validate a tool manifest JSON file against the ERC-XXXX schema.

```bash
npx @opensea/tool-sdk validate ./manifest.json
```

### `hash [path]`

Compute the JCS keccak256 hash of a tool manifest (RFC 8785 canonicalization).

```bash
npx @opensea/tool-sdk hash ./manifest.json
```

### `export [path]`

Load a TypeScript manifest and output it as JSON. Validates the manifest before printing.

```bash
npx @opensea/tool-sdk export ./src/manifest.ts
```

### `verify <url>`

Verify a deployed well-known tool endpoint. Checks URL format, HTTP 200, schema validation, and origin binding.

```bash
npx @opensea/tool-sdk verify https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json
```

### `register`

Register a tool onchain via the ToolRegistry contract.

```bash
PRIVATE_KEY=0x... RPC_URL=https://... npx @opensea/tool-sdk register \
  --metadata <url> \
  --network base \
  --nft-gate 0x...  # optional: NFT collection for predicate
```

| Flag | Description |
|------|-------------|
| `--metadata <url>` | Metadata URI (required) |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--nft-gate <address>` | NFT collection for SimpleNFT721PredicateFactory |
| `--access-predicate <address>` | Manual access predicate address |
| `--dry-run` | Print summary without transacting |
| `-y, --yes` | Skip confirmation prompt |

### `update-metadata`

Update a tool's metadata URI and manifest hash onchain.

```bash
npx @opensea/tool-sdk update-metadata \
  --tool-id 1 \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base
```

| Flag | Description |
|------|-------------|
| `--tool-id <id>` | Numeric tool ID (required) |
| `--metadata <url>` | New metadata URI (required) |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint for gas estimation and tx broadcast |
| `--dry-run` | Print summary without transacting |
| `-y, --yes` | Skip confirmation prompt |

### `inspect`

Read onchain tool state and cross-check against the live manifest.

```bash
npx @opensea/tool-sdk inspect --tool-id 1 --network base
npx @opensea/tool-sdk inspect --tool-id 1 --check-access 0xYourAddress
```

| Flag | Description |
|------|-------------|
| `--tool-id <id>` | Numeric tool ID (required) |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--check-access <address>` | Check whether an address has access to the tool |

### `deploy`

Deploy a tool-sdk project to a hosting platform.

```bash
npx @opensea/tool-sdk deploy --host vercel
npx @opensea/tool-sdk deploy --host vercel --non-interactive -y
```

| Flag | Description |
|------|-------------|
| `--host <host>` | Hosting platform (required; currently `vercel`) |
| `--non-interactive` | Read env var values from environment (for CI) |
| `-y, --yes` | Auto-confirm prompts (e.g., Vercel link) |

### `pay <url>`

Make a paid call to a tool endpoint via x402. Probes the endpoint for payment requirements, signs an EIP-3009 `transferWithAuthorization`, and replays the request with the `X-Payment` header.

```bash
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body (inline string or `@path/to/file.json`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |

### `auth <url>`

Make an authenticated call to a predicate-gated tool endpoint via SIWE.

```bash
TOOL_SDK_PRIVATE_KEY=0x... npx @opensea/tool-sdk auth https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body (inline string or `@path/to/file.json`) |
| `--key <hex>` | Wallet private key (defaults to `TOOL_SDK_PRIVATE_KEY` env var) — use env var in production to avoid exposing keys in shell history |

### `dry-run-gate`

Invoke a tool handler locally with no `X-Payment` header and assert a valid 402 response (x402 gate test).

```bash
npx @opensea/tool-sdk dry-run-gate \
  --manifest ./src/manifest.ts \
  --input '{"query":"test"}'
```

| Flag | Description |
|------|-------------|
| `--manifest <path>` | Path to manifest `.ts` or `.json` file (required) |
| `--input <json>` | JSON input body (inline or `@path`) |

### `dry-run-predicate-gate`

Invoke a tool handler locally with no SIWE auth header and assert a valid 401 response (predicate gate test).

```bash
npx @opensea/tool-sdk dry-run-predicate-gate \
  --manifest ./src/manifest.ts \
  --tool-id 1
```

| Flag | Description |
|------|-------------|
| `--manifest <path>` | Path to manifest `.ts` or `.json` file (required) |
| `--tool-id <id>` | Onchain tool ID to configure in the gate |
| `--input <json>` | JSON input body (inline or `@path`) |

## Library API

### `defineManifest(manifest)`

Type-narrowing identity function for manifest definitions.

```typescript
import { defineManifest } from "@opensea/tool-sdk"

export const manifest = defineManifest({
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "my-tool",
  description: "A useful tool",
  endpoint: "https://my-tool.vercel.app",
  inputs: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  outputs: {
    type: "object",
    properties: { result: { type: "string" } },
  },
  creatorAddress: "0x1234567890abcdef1234567890abcdef12345678",
})
```

### `validateManifest(data)`

Validates unknown data against the ERC-XXXX manifest schema.

```typescript
import { validateManifest } from "@opensea/tool-sdk"

const result = validateManifest(jsonData)
if (result.success) {
  console.log(result.data.name)
} else {
  console.error(result.error.issues)
}
```

### `createToolHandler(config)`

Creates a Web Request/Response handler for your tool.

```typescript
import { z } from "zod/v4"
import { createToolHandler } from "@opensea/tool-sdk"
import { manifest } from "./manifest.js"

const handler = createToolHandler({
  manifest,
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [], // optional: nftGate, x402Gate
  handler: async (input, ctx) => {
    return { result: `Hello: ${input.query}` }
  },
})
```

### `createWellKnownHandler(manifest)`

Creates a handler for the `/.well-known/ai-tool/<slug>.json` endpoint.

```typescript
import { createWellKnownHandler } from "@opensea/tool-sdk"

const wellKnown = createWellKnownHandler(manifest)
// Responds at /.well-known/ai-tool/<derived-slug>.json
```

### `computeManifestHash(manifest)`

Computes the JCS keccak256 hash of a manifest (RFC 8785 canonicalization + keccak256).

```typescript
import { computeManifestHash } from "@opensea/tool-sdk"

const hash = computeManifestHash(manifest)
// => "0x85f160012d9fd30c7e82bc9d3959c90ec9df3c7d..."
```

### `ToolRegistryClient`

Client for interacting with the onchain ToolRegistry contract.

```typescript
import { ToolRegistryClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const client = new ToolRegistryClient({
  chain: base,
  walletClient, // viem WalletClient with account
})

const { toolId, txHash } = await client.registerTool({
  metadataURI: "https://example.com/.well-known/ai-tool/my-tool.json",
  manifest,
})
```

## Gating

### Predicate Gate (recommended)

Delegates the access decision to the onchain `ToolRegistry`. The middleware
verifies SIWE auth, recovers the caller's address, and staticcalls
`IToolRegistry.tryHasAccess(toolId, caller, data)`. Whatever predicate the
tool's creator registered (single-collection ERC-721, multi-collection,
ERC-1155, subscription, composite, anything future) is the policy enforced.

```typescript
import { predicateGate } from "@opensea/tool-sdk"

const gate = predicateGate({
  toolId: 42n,                          // from the ToolRegistered event
  rpcUrl: "https://mainnet.base.org",   // optional
})

const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [gate],
  handler: async (input, ctx) => {
    // ctx.callerAddress is set on success
    // ctx.gates.predicate.granted === true
    return { result: "access granted" }
  },
})
```

Status code mapping:

| Outcome | Status | Body |
| --- | --- | --- |
| Missing or malformed SIWE | `401` | `{ error, hint }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "Predicate misbehaved..." }` |

The `predicate` field in the 403 body is the registered access predicate's
address, fetched lazily from `getToolConfig` on first denial and cached
in-process. Callers can read the predicate's onchain config to learn what
they need to satisfy.

Authorization header format: `SIWE <base64url(siwe-message)>.<hex-signature>`

> **Note:** Stateless SIWE: does not track nonces. Callers should include a
> short-lived `expirationTime` in their SIWE messages to limit replay window.
> Tool operators requiring stronger replay protection should implement
> server-side nonce tracking.

### Client-side access preview

Off-chain helper for clients that want to gate UI before invocation. Same
staticcall as `predicateGate`, no SIWE required.

```typescript
import { checkToolAccess } from "@opensea/tool-sdk"

const { ok, granted } = await checkToolAccess({
  toolId: 42n,
  account: "0xabc...",
  rpcUrl: "https://mainnet.base.org", // optional
})

if (ok && granted) {
  // enable "Use Tool" affordance
}
```

`ok === false` means the predicate misbehaved upstream and the result is
indeterminate; treat it as a transient failure, not a denial.

### NFT Gate (deprecated)

> **Deprecated.** Prefer `predicateGate` for any tool registered against the
> canonical `ToolRegistry`. `nftGate` re-implements ERC-721 ownership
> off-chain against a single hardcoded collection address, which means the
> off-chain policy can drift from the onchain `accessPredicate` and
> multi-collection / non-ERC-721 access models require parallel
> implementations. Use `nftGate` only for local development and unregistered
> tools where you do not yet have a `toolId`.

Requires callers to hold an ERC-721 NFT. Uses SIWE (Sign-In with Ethereum) for address verification.

```typescript
import { nftGate } from "@opensea/tool-sdk"

const gate = nftGate({
  collection: "0x1234...5678", // ERC-721 on Base
  rpcUrl: "https://mainnet.base.org", // optional
})

const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [gate],
  handler: async (input, ctx) => {
    // ctx.callerAddress is set on success
    // ctx.gates.nft.granted === true
    return { result: "access granted" }
  },
})
```

Authorization header format: `SIWE <base64url(siwe-message)>.<hex-signature>`

> **Note:** The NFT gate is stateless and does not track nonces. Callers should
> include a short-lived `expirationTime` in their SIWE messages to limit replay
> window. Tool operators requiring stronger replay protection should implement
> server-side nonce tracking.

### x402 Gate (hosted facilitator)

The SDK ships two hosted-facilitator gates with the same shape:
`payaiX402Gate` (PayAI hosted facilitator — free, no auth required) and
`cdpX402Gate` (Coinbase Developer Platform facilitator — requires a CDP API
key and JWT auth). Pick one based on the trade-offs:

| Gate | Facilitator | Auth | Best for |
| --- | --- | --- | --- |
| `payaiX402Gate` | PayAI (`https://facilitator.payai.network`) | None | Prototyping, dogfooding, anything you want to deploy today |
| `cdpX402Gate` | Coinbase Developer Platform (`https://api.cdp.coinbase.com/platform/v2/x402`) | CDP JWT (you supply via `createAuthHeaders`) | Production, when you have CDP credentials |

Both emit an x402-protocol-compliant 402 response with
`accepts: [PaymentRequirements]` when `X-Payment` is missing, and verify the
payload against the facilitator's `/verify` endpoint when present. The
manifest-side helper `x402UsdcPricing` is shared — the advertised price is
identical regardless of which facilitator enforces it.

**Trade-offs:**

- **PayAI** is community-operated. It is free and requires no credentials,
  which is exactly the right fit for a first deploy. It comes with no
  uptime SLA and its operational maturity is whatever the community has
  built. For real money flowing at volume, evaluate CDP.
- **CDP** is operated by Coinbase. It requires JWT auth signed with your
  `CDP_API_KEY_SECRET`. The SDK does not bundle a JWT signer; pass a
  `createAuthHeaders` callback that mints headers per request. A built-in
  helper that wraps `@coinbase/cdp-sdk` is a planned follow-up.

#### PayAI (recommended for first deploys)

```typescript
import {
  createToolHandler,
  defineManifest,
  payaiX402Gate,
  x402UsdcPricing,
} from "@opensea/tool-sdk"

const gate = payaiX402Gate({
  recipient: "0xYourPayoutAddress",
  amountUsdc: "0.01", // decimal string; "10000" (base units) also accepted
})

export const manifest = defineManifest({
  // ...
  pricing: x402UsdcPricing({
    recipient: "0xYourPayoutAddress",
    amountUsdc: "0.01",
  }),
})

const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [gate],
  handler: async (input, ctx) => {
    // ctx.gates.x402.paid === true
    return { /* ... */ }
  },
})
```

#### CDP (production)

```typescript
import { cdpX402Gate, x402UsdcPricing } from "@opensea/tool-sdk"
import { generateCdpJwt } from "./your-cdp-auth.js" // your code, today

const gate = cdpX402Gate({
  recipient: "0xYourPayoutAddress",
  amountUsdc: "0.01",
  createAuthHeaders: async () => ({
    Authorization: `Bearer ${await generateCdpJwt({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      method: "POST",
      path: "/platform/v2/x402/verify",
    })}`,
  }),
})
```

If you omit `createAuthHeaders` on `cdpX402Gate`, every verify call returns
401/403 from CDP and the gate surfaces 502. PayAI is the unauthenticated
fallback for development.

**Common defaults:** USDC on Base mainnet, `maxTimeoutSeconds: 60`,
description `"Tool invocation"`. `network: "base-sepolia"` is supported for
testing. Override any default via the config; `facilitatorUrl` is also
overridable if you want to pin to a specific facilitator instance.

**Settlement.** Both gates settle on chain automatically: the gate verifies
the payment before your handler runs, then calls the facilitator's `/settle`
endpoint after your handler succeeds and the output validates. USDC moves
from payer to `recipient` once `/settle` confirms. The settled tx hash is
stashed on `ctx.gates.x402.settlementTxHash` for downstream observability.

**Latency.** Settlement runs synchronously: the SDK awaits `/settle` before
returning the response, so a slow or unreachable facilitator adds up to 10
seconds (the per-call timeout) to the worst-case response time. Truly
non-blocking settlement requires runtime-specific primitives (Cloudflare
Workers and Vercel `waitUntil`) that are not portable across the runtimes
this SDK supports, and fire-and-forget risks dropped settlements when a
serverless process is killed after the response is sent. Blocking is the
safest cross-runtime default; if you need lower-latency settlement, plumb
the runtime's `waitUntil` into your handler and wrap the gate yourself.

**Failure handling.** If `/settle` fails (network blip, facilitator outage,
nonce already used), the failure is logged via `console.error` with prefix
`[tool-sdk] gate.settle failed:` and the response still returns 200 with
the handler's output. Operators replay failed settlements out-of-band using
the verified payment payload from logs.

### x402 Gate (advanced: custom facilitator)

The lower-level `x402Gate` accepts a `verifyPayment` callback for callers who
want to run their own facilitator or verify payments without an HTTP round-trip.

```typescript
import { x402Gate } from "@opensea/tool-sdk"

const gate = x402Gate({
  pricing: [
    {
      amount: "20000",
      asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      recipient: "eip155:8453:0xYourAddress",
      protocol: "x402",
    },
  ],
  verifyPayment: async (proof) => {
    return validateX402ProofYourself(proof)
  },
})
```

If `verifyPayment` is omitted, the gate rejects every request with an `X-Payment`
header with a 501 error. Use `payaiX402Gate` (or `cdpX402Gate`) if you do not
have a reason to run your own facilitator.

### Client-side x402

Two helpers for **callers** of x402-gated tools — sign EIP-3009
`TransferWithAuthorization` payments and replay requests automatically.

#### `signX402Payment`

Signs a USDC payment authorization and returns a base64-encoded `X-Payment`
header value. Requires a viem `Account` with `signTypedData` support (e.g.
`privateKeyToAccount`).

```typescript
import { signX402Payment } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount("0x...")
const xPayment = await signX402Payment({
  account,
  paymentRequirements: {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "10000",
    payTo: "0xRecipient",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
})

const res = await fetch(toolUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Payment": xPayment },
  body: JSON.stringify(payload),
})
```

#### `paidFetch`

Drop-in fetch wrapper that handles the 402 → sign → replay flow
automatically. If the server does not return 402, the response is passed
through unchanged.

**Security:** `paidFetch` trusts the server's 402 response to determine
the payment recipient, token, and amount. Use `maxAmount`,
`allowedRecipients`, and `allowedAssets` to constrain what gets signed.
By default, `asset` is validated against the known USDC contract address
for the network, and `payTo` is rejected if it is the zero address or a
known burn address.

```typescript
import { paidFetch } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount("0x...")
const res = await paidFetch("https://tool.example.com/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "what is this NFT worth?" }),
  account,
  // Optional safety caps:
  maxAmount: "100000",                          // reject if server asks for more than 0.10 USDC
  allowedRecipients: ["0xYourTrustedPayee"],    // reject unknown payTo addresses
  // allowedAssets defaults to the known USDC contract per network
})
const data = await res.json()
```

### Predicate-Gated Tools

Gate your tool using the onchain access predicate system. The `predicateGate` middleware verifies SIWE auth, recovers the caller's address, and delegates the access decision to `IToolRegistry.tryHasAccess` — it works with ERC721OwnerPredicate, ERC1155OwnerPredicate, SubscriptionPredicate, CompositePredicate, or any future predicate automatically.

See [docs/predicate-gating-guide.md](docs/predicate-gating-guide.md) for the full setup walkthrough.

## Tips

### `ai@4` + `zod@4` type mismatch

`ai@4` (Vercel AI SDK) ships its own `jsonSchema()` helper that expects a
JSON Schema object, **not** a Zod schema. If you pass a `zod@4` schema to
`generateObject`'s `schema` parameter it will typecheck but the return type
is `unknown` because `ai@4` does not recognise Zod 4's schema brand.

The working pattern is to define a hand-written JSON Schema for `ai`, then
validate the result at runtime with Zod:

```typescript
import { generateObject } from "ai"
import { jsonSchema } from "ai/json-schema"
import { z } from "zod/v4"

// 1. Hand-written JSON Schema for the AI SDK
const myJsonSchema = jsonSchema({
  type: "object",
  properties: {
    name: { type: "string" },
    score: { type: "number" },
  },
  required: ["name", "score"],
})

// 2. Matching Zod schema for runtime validation
const MySchema = z.object({
  name: z.string(),
  score: z.number(),
})

const { object } = await generateObject({
  model,
  schema: myJsonSchema,
  prompt: "...",
})

// 3. Validate at runtime — `object` is typed as `unknown` from ai@4
const parsed = MySchema.parse(object)
// `parsed` is now fully typed as { name: string; score: number }
```

## Framework Adapters

### Vercel

```typescript
import { toVercelHandler } from "@opensea/tool-sdk"

export default toVercelHandler(handler)
```

### Cloudflare Workers

```typescript
import { toCloudflareHandler } from "@opensea/tool-sdk/cloudflare"

export default toCloudflareHandler(handler)
```

### Express

```typescript
import { toExpressHandler } from "@opensea/tool-sdk"

app.post("/api", toExpressHandler(handler))
```

## ERC Spec

See the full [ERC-XXXX Tool Registry specification](../tool-registry/eip-xxxx-tool-registry.md) for details on manifest schema, origin binding, creator binding, and consumer verification.
