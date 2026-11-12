# @opensea/tool-sdk

SDK and CLI for building [ERC-8257](https://github.com/ethereum/ERCs/pull/1723) AI agent tools: manifest validation, onchain registration, gating middleware, framework adapters, and project scaffolding.

The onchain side lives in [ProjectOpenSea/tool-registry](https://github.com/ProjectOpenSea/tool-registry), which holds the `ToolRegistry` contract and the example access predicates this SDK reads and writes.

## Quick start

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

## CLI reference

`npx @opensea/tool-sdk --help` lists the current commands and flags. This section can lag behind it.

Every command that takes `--network` accepts `base` or `mainnet` and defaults to `base`. Commands that sign need a wallet; see [Wallet configuration](#wallet-configuration).

### `init [name]`

Scaffolds a tool project from a Vercel, Cloudflare Workers, or Express template, with interactive prompts.

```bash
npx @opensea/tool-sdk init my-tool
npx @opensea/tool-sdk init my-tool --no-interactive  # CI mode
```

### `validate [path]`

Validates a manifest JSON file against the ERC-8257 schema. Namespaced extension fields are allowed and kept. Bare (un-namespaced) extension fields produce a warning, since ERC-8257 expects a reverse-DNS prefix.

```bash
npx @opensea/tool-sdk validate ./manifest.json
```

### `hash [path]`

Computes the JCS keccak256 hash of a manifest (RFC 8785 canonicalization).

```bash
npx @opensea/tool-sdk hash ./manifest.json
```

Per ERC-8257 §2, the hash covers the manifest exactly as served. Every field counts, namespaced extensions included, and nothing is stripped or defaulted first, so any RFC 8785 implementation gets the same result. Bare-extension warnings go to stderr, so piping stdout gives you only the hash.

### `export [path]`

Loads a TypeScript manifest, validates it, and prints it as JSON.

```bash
npx @opensea/tool-sdk export ./src/manifest.ts
```

### `verify <url>`

Checks a deployed well-known endpoint: URL format, HTTP 200, schema validation, and origin binding.

```bash
npx @opensea/tool-sdk verify https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json
```

### `register`

Registers a tool with the ToolRegistry contract, optionally configuring an access predicate in the same run.

```bash
PRIVATE_KEY=0x... RPC_URL=https://... npx @opensea/tool-sdk register \
  --metadata <url> \
  --network base \
  --nft-gate 0xCOLLECTION  # optional: gate via ERC721OwnerPredicate

# Or gate via ERC20BalancePredicate (one-shot register + configure):
PRIVATE_KEY=0x... RPC_URL=https://... npx @opensea/tool-sdk register \
  --metadata <url> \
  --network base \
  --erc20-gate 0xTOKEN_ADDRESS --erc20-min-balance 1000000000000000000
```

| Flag | Description |
|------|-------------|
| `--metadata <url>` | Metadata URI (required) |
| `--network <network>` | `base` or `mainnet` |
| `--nft-gate <address>` | ERC-721 collection to gate on, via the canonical ERC721OwnerPredicate (version detected from the registry) |
| `--erc20-gate <address>` | ERC-20 token to gate on, via the canonical ERC20BalancePredicate. Needs `--erc20-min-balance`. Cannot be combined with `--nft-gate` |
| `--erc20-min-balance <amount>` | Minimum balance in raw units (`1000000000000000000` for 1e18). Required with `--erc20-gate` |
| `--access-predicate <address>` | Custom access predicate. Cannot be combined with `--nft-gate` or `--erc20-gate` |
| `--predicate-config <json>` | Predicate config to set during registration, e.g. `'{"collections":["0x..."]}'` or `'{"token":"0x...","minBalance":"1000000000000000000"}'` |
| `--wallet-provider <provider>` | Signing wallet provider |
| `--rpc-url <url>` | RPC endpoint for gas estimation and broadcast |
| `--dry-run` | Print a summary without sending transactions |
| `-y, --yes` | Skip the confirmation prompt |

### `update-metadata`

Updates a tool's metadata URI and manifest hash onchain.

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
| `--network <network>` | `base` or `mainnet` |
| `--wallet-provider <provider>` | Signing wallet provider |
| `--rpc-url <url>` | RPC endpoint for gas estimation and broadcast |
| `--dry-run` | Print a summary without sending transactions |
| `-y, --yes` | Skip the confirmation prompt |

### `inspect`

Reads a tool's onchain state and cross-checks it against the live manifest.

```bash
npx @opensea/tool-sdk inspect --tool-id 1 --network base
npx @opensea/tool-sdk inspect --tool-id 1 --check-access 0xYourAddress
```

| Flag | Description |
|------|-------------|
| `--tool-id <id>` | Numeric tool ID (required) |
| `--network <network>` | `base` or `mainnet` |
| `--rpc-url <url>` | RPC endpoint |
| `--check-access <address>` | Report whether this address has access |

### `deploy`

Deploys the project to a host. Vercel is the only host today.

```bash
npx @opensea/tool-sdk deploy --host vercel
npx @opensea/tool-sdk deploy --host vercel --non-interactive
```

| Flag | Description |
|------|-------------|
| `--host <host>` | Hosting platform (required; `vercel`) |
| `--non-interactive` | Read env var values from the environment (for CI) |

### `pay <url>`

Makes a paid x402 call. The command probes the endpoint for its 402 challenge, signs an EIP-3009 `TransferWithAuthorization` into the `X-Payment` header, and replays the request. It works for gated tools too: the challenge sets the amount, which is real USDC for a paid tool and zero for identity-only gating.

```bash
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body, inline or `@path/to/file.json` |
| `--method <verb>` | HTTP method. Defaults to POST, and falls back to GET if the POST probe returns 404 or 405 |
| `--wallet-provider <provider>` | Signing wallet provider |
| `--max-amount <baseUnits>` | Reject challenges that charge more than this, in token base units. `unlimited` disables the cap |
| `--no-report-usage` | Skip the usage report sent to OpenSea after a successful payment |
| `--api-key <key>` | API key for usage reporting. Falls back to `OPENSEA_API_KEY`, then to an auto-provisioned instant key |
| `--tool-ref <ref>` | Tool coordinates as `chainId,registryAddress,onchainId`, e.g. `8453,0x265b...2cf1,65`, or `8453,x402_bazaar,123` for x402 registries |

If one endpoint URL maps to several registered tools, the usage report fails with `400 Multiple tools registered for endpoint`. Pass `--tool-ref` to name the exact tool. For x402 registries the source tokens are `x402_bazaar` and `x402_bankr`; the legacy `x402:bazaar` and `x402:bankr` forms are accepted and normalized. Fields are comma-separated so the registry part stays unambiguous.

```bash
# Onchain (ERC-8257) registry:
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}' \
  --tool-ref 8453,0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1,65

# x402 registry (not registered onchain):
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}' \
  --tool-ref 8453,x402_bazaar,8679018179619845322
```

### `auth <url>`

Calls a predicate-gated endpoint with a zero-value EIP-3009 authorization.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk auth https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body, inline or `@path/to/file.json` |
| `--wallet-provider <provider>` | Signing wallet provider |

### `dry-run-gate`

Runs the handler locally without an `X-Payment` header and asserts a valid x402 402 response.

```bash
npx @opensea/tool-sdk dry-run-gate \
  --manifest ./src/manifest.ts \
  --input '{"query":"test"}'
```

| Flag | Description |
|------|-------------|
| `--manifest <path>` | Manifest `.ts` or `.json` file (required) |
| `--input <json>` | JSON input body, inline or `@path` |

### `dry-run-predicate-gate`

Runs the handler locally without an auth header and asserts a valid 402 challenge. `--operator-address` is required.

```bash
npx @opensea/tool-sdk dry-run-predicate-gate \
  --manifest ./src/manifest.ts \
  --tool-id 1
```

| Flag | Description |
|------|-------------|
| `--manifest <path>` | Manifest `.ts` or `.json` file (required) |
| `--tool-id <id>` | Onchain tool ID to configure in the gate |
| `--input <json>` | JSON input body, inline or `@path` |

### `smoke`

Smoke-tests a live endpoint: signs an EIP-3009 authorization, sends the request, and checks the HTTP status. For paywalled tools, a 402 counts as "auth passed, payment required".

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk smoke \
  --endpoint https://my-tool.vercel.app/api/tool \
  --tool-id 4 \
  --input '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--endpoint <url>` | Production endpoint URL (required) |
| `--tool-id <id>` | Onchain tool ID, shown in log output |
| `--input <json>` | JSON body, inline or `@path` (default `{}`) |
| `--expect <status>` | Expected HTTP status |
| `--chain <name>` | Chain for the wallet client and EIP-3009 signature (default `base`) |
| `--paid` | Pay the x402 challenge after authenticating |
| `--wallet-provider <provider>` | Signing wallet provider |
| `--max-amount <amount>` | Payment cap in base units (default `1000000`, 1 USDC) |

### Predicate configuration commands

These configure or read the gate on a tool that is already registered. Write commands accept `--wallet-provider`, `--rpc-url`, and `--dry-run` (print a summary or the encoded calldata without sending). Read commands accept `--rpc-url`. Commands for the trait and ERC-20 predicates use the canonical predicate address for the network unless you pass `--predicate-address`.

| Command | What it does |
|---------|--------------|
| `set-collections <toolId> <addresses...>` | Set the ERC-721 collection list |
| `get-collections <toolId>` | Read the ERC-721 collection list |
| `set-collection-tokens <toolId> <address> <tokenIds...>` | Set the ERC-1155 collection and token IDs |
| `configure-subscription <toolId> <collection>` | Configure SubscriptionPredicate. `--min-tier <tier>` is a uint8 (0-255, default `0`) |
| `configure-trait-gating <toolId> <collection> <traitKey> <allowedValues...>` | Configure TraitGatedPredicate (ERC-721 ownership plus ERC-7496 trait match). `--traits-contract <address>` points at a separate traits contract; it defaults to the collection |
| `get-trait-config <toolId>` | Read the trait gating config |
| `configure-erc20-gate <toolId> <token> <minBalance>` | Configure ERC20BalancePredicate. The signer must be the tool creator |
| `get-erc20-config <toolId>` | Read the ERC-20 balance gating config |

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk set-collections 4 \
  0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9 \
  --network base

npx @opensea/tool-sdk get-collections 4 --network base

PRIVATE_KEY=0x... npx @opensea/tool-sdk set-collection-tokens 4 \
  0xCOLLECTION_ADDRESS 1 2 3 \
  --network base

PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-subscription 4 \
  0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626 \
  --min-tier 0 --network base

PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-trait-gating 4 \
  0xNFT_COLLECTION tier Rare Legendary \
  --network base

# With a separate ERC-7496 traits/renderer contract:
PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-trait-gating 4 \
  0xNFT_COLLECTION tier Rare Legendary \
  --traits-contract 0xRENDERER --network base

npx @opensea/tool-sdk get-trait-config 4 --network base

PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-erc20-gate 4 \
  0xTOKEN_ADDRESS 1000000000000000000 \
  --network base

npx @opensea/tool-sdk get-erc20-config 4 --network base
```

`configure-trait-gating` encodes `traitKey` and each allowed value as a left-aligned, zero-padded bytes32, which must match how the traits contract stores them. `bytes32(0)` is rejected as an allowed value because it is what an unset trait returns.

### Wallet configuration

Signing commands (`register`, `update-metadata`, `pay`, `auth`, `smoke`, `set-collections`, `set-collection-tokens`, `configure-subscription`, `configure-trait-gating`, `configure-erc20-gate`) pick a wallet in one of two ways:

1. Pass `--wallet-provider <name>`.
2. Set the env vars for a provider and let the CLI detect it. When several are set, the order is Privy, Fireblocks, Turnkey, Bankr, then private key.

| Provider | `--wallet-provider` value | Env vars |
|----------|--------------------------|----------|
| Privy | `privy` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` |
| Fireblocks | `fireblocks` | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET`, `FIREBLOCKS_VAULT_ID` |
| Turnkey | `turnkey` | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_WALLET_ADDRESS`, `TURNKEY_RPC_URL` |
| Bankr | `bankr` | `BANKR_API_KEY` |
| Private key | `private-key` | `PRIVATE_KEY`, plus `RPC_URL` for sending transactions |

[`.env.example`](.env.example) is an annotated template.

```bash
# Auto-detect from env vars (simplest)
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk register \
  --metadata <url> --network base

# Explicit provider selection
BANKR_API_KEY=... npx @opensea/tool-sdk register \
  --metadata <url> --network base --wallet-provider bankr

# Privy server wallet
PRIVY_APP_ID=... PRIVY_APP_SECRET=... PRIVY_WALLET_ID=... npx @opensea/tool-sdk auth \
  https://my-tool.vercel.app/api/tool --body '{"query":"hello"}'
```

## Library API

### `defineManifest(manifest)`

Identity function that narrows the manifest type.

```typescript
import { defineManifest } from "@opensea/tool-sdk"

export const manifest = defineManifest({
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
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

Validates unknown data against the ERC-8257 manifest schema. Namespaced extension fields are kept and no defaults are injected, so the result still matches what you serve and hash.

```typescript
import { validateManifest } from "@opensea/tool-sdk"

const result = validateManifest(jsonData)
if (result.success) {
  console.log(result.data.name)
} else {
  console.error(result.error.issues)
}
```

### `findBareExtensionKeys(data)`

Returns top-level fields that are neither in the ERC-8257 schema nor namespaced, such as `paymentHint`. The manifest hash still covers them, but ERC-8257 requires extensions to be namespaced (reverse-DNS like `io.opensea.paymentHint`, or the legacy `x-` prefix) so they cannot collide with future spec fields. Returns an empty array when `data` is not a JSON object.

```typescript
import { findBareExtensionKeys } from "@opensea/tool-sdk"

const bare = findBareExtensionKeys(jsonData)
if (bare.length > 0) {
  console.warn(`Namespace these extension fields: ${bare.join(", ")}`)
}
```

### `createToolHandler(config)`

Builds a Web `Request`/`Response` handler for your tool. See [Input validation](#input-validation) for what it checks.

```typescript
import { z } from "zod/v4"
import { createToolHandler } from "@opensea/tool-sdk"
import { manifest } from "./manifest.js"

const handler = createToolHandler({
  manifest,
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [], // optional: predicateGate, x402Gate
  handler: async (input, ctx) => {
    return { result: `Hello: ${input.query}` }
  },
})
```

### `createWellKnownHandler(manifest)`

Serves the manifest at `/.well-known/ai-tool/<slug>.json`.

```typescript
import { createWellKnownHandler } from "@opensea/tool-sdk"

const wellKnown = createWellKnownHandler(manifest)
// Responds at /.well-known/ai-tool/<derived-slug>.json
```

### `computeManifestHash(manifest)`

Computes the JCS keccak256 hash (RFC 8785 canonicalization, then keccak256). Pass the manifest as served or authored, such as the fetched response body, with every field intact. A schema-stripped or defaulted copy produces a hash that other verifiers will not reproduce.

```typescript
import { computeManifestHash } from "@opensea/tool-sdk"

const hash = computeManifestHash(manifest)
// => "0x85f160012d9fd30c7e82bc9d3959c90ec9df3c7d..."
```

### `ToolRegistryClient`

Client for the onchain ToolRegistry contract.

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

### Framework adapters

Wrap a `createToolHandler` handler for your runtime. `toCloudflareHandler` also passes the Worker's `ctx.waitUntil` to the handler.

```typescript
// Vercel
import { toVercelHandler } from "@opensea/tool-sdk"

export default toVercelHandler(handler)
```

```typescript
// Cloudflare Workers
import { toCloudflareHandler } from "@opensea/tool-sdk/cloudflare"

export default toCloudflareHandler(handler)
```

```typescript
// Express
import { toExpressHandler } from "@opensea/tool-sdk"

app.post("/api", toExpressHandler(handler))
```

## Gating

[docs/tool-invocation-flow.md](docs/tool-invocation-flow.md) diagrams the full 402 challenge-response lifecycle: identity check, access check, payment settlement, and usage reporting.

### Predicate gate (recommended)

`predicateGate` hands the access decision to the onchain `ToolRegistry`, so whatever predicate the tool creator registered is the policy: ERC-721, multi-collection, ERC-1155, subscription, ERC-20 balance, composite, or one written later.

The flow:

1. With `operatorAddress` configured, a request without auth gets a 402 whose `PaymentRequirements` has `maxAmountRequired: "0"`. The `payTo` address is derived from the endpoint URL, tool ID, and operator.
2. The client checks that binding, signs a zero-value `X-Payment`, and retries. An authorization captured by another endpoint cannot be replayed here.
3. The middleware recovers the caller with `ecrecover` and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)`.

```typescript
import { predicateGate } from "@opensea/tool-sdk"

const gate = predicateGate({
  toolId: 42n,                          // from the ToolRegistered event
  operatorAddress: "0xYOUR_OPERATOR",   // included in the audience binding
  rpcUrl: "https://mainnet.base.org",   // optional
  // audience: "https://tool.example/api", // only if a proxy rewrites request.url
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

| Outcome | Status | Body |
| --- | --- | --- |
| No `X-Payment` header | `402` | `{ accepts: [{ payTo, maxAmountRequired: "0", scheme: "exact", ... }] }` |
| Malformed `X-Payment` | `401` | `{ error }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "Predicate misbehaved..." }` |

`predicate` in the 403 body is the registered predicate's address, read from `getToolConfig` on the first denial and cached in-process. Callers can read that predicate's onchain config to see what they need.

The gate reads only `X-Payment`: a zero-value EIP-3009 `TransferWithAuthorization` signed in response to the 402 challenge. `eip3009AuthenticatedFetch` handles that round trip on the client.

The gate rejects expired authorizations and any `validBefore` more than 1 hour out. SDK clients sign shorter windows: 5 minutes for zero-value, 10 minutes for paid. Each authorization carries a random signed nonce. If one authorization must run the handler at most once, configure `replayGuard`; see [Replay protection](#replay-protection).

#### Predicate plus payment (`paidPredicateGate`)

For tools that need both predicate access and an x402 payment, `paidPredicateGate` settles identity and payment in one 402 round trip (2 requests instead of 3):

```typescript
import { paidPredicateGate } from "@opensea/tool-sdk"
import { mainnet } from "viem/chains"

gates: [
  paidPredicateGate({
    toolId: 1n,
    operatorAddress: "0xYOUR_WALLET",
    amountUsdc: "0.05",
    chain: mainnet,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
  }),
]
```

The 402 challenge advertises the real price. The caller's `X-Payment` signature proves identity (`from`) and authorizes the payment at once. The gate checks the predicate before settling, so a denied caller pays nothing.

#### Delegated agent access (delegate.xyz)

An agent can call a predicate-gated tool for an NFT holder without the holder's key. The holder delegates to the agent at [delegate.xyz](https://delegate.xyz) (one onchain transaction, revocable), and the agent sends the holder's address:

```typescript
import { eip3009AuthenticatedFetch } from "@opensea/tool-sdk"

const response = await eip3009AuthenticatedFetch(toolUrl, {
  method: "POST",
  headers: {
    "X-Delegate-For": holderAddress,      // holder who delegated
  },
  account: agentAccount,
  body: JSON.stringify({ query: "hello" }),
})
```

With `X-Delegate-For` set, the middleware:

1. Verifies the agent's identity as usual (`X-Payment` or `Authorization: EIP-3009`).
2. Calls `checkDelegateForAll(agent, holder)` on the [delegate.xyz DelegateRegistry](https://docs.delegate.xyz).
3. Runs the access predicate against the holder, not the agent.
4. Sets `ctx.callerAddress` to the holder and `ctx.agentAddress` to the agent.

| Outcome | Status | Body |
| --- | --- | --- |
| Invalid `X-Delegate-For` format | `400` | `{ error }` |
| Delegation not found onchain | `403` | `{ error, hint }` |
| Delegate registry call failed | `502` | `{ error }` |

[docs/predicate-gating-guide.md](docs/predicate-gating-guide.md) walks through predicate setup and delegation end to end.

### Client-side access preview

`checkToolAccess` runs the same staticcall as `predicateGate` without authentication, so a client can gate UI before invoking.

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

`ok === false` means the predicate misbehaved and the answer is unknown. Treat it as a transient failure, not a denial.

### x402 gate (hosted facilitator)

Two gates share the same shape and differ in which facilitator verifies and settles payments:

| Gate | Facilitator | Auth | Use it for |
| --- | --- | --- | --- |
| `payaiX402Gate` | PayAI (`https://facilitator.payai.network`) | None | Prototypes and first deploys |
| `cdpX402Gate` | Coinbase Developer Platform (`https://api.cdp.coinbase.com/platform/v2/x402`) | CDP JWT, supplied through `createAuthHeaders` | Production, once you have CDP credentials |

PayAI is community-operated, free, and has no uptime SLA. Evaluate CDP before real volume flows through it. CDP needs a JWT signed with your `CDP_API_KEY_SECRET`; the SDK does not bundle a signer, so you pass a `createAuthHeaders` callback that mints headers per request.

Both gates return a spec-compliant 402 with `accepts: [PaymentRequirements]` when `X-Payment` is missing, and verify the payload against the facilitator's `/verify` endpoint when it is present. Use `x402UsdcPricing` to advertise the price in the manifest; it is the same for either gate.

#### PayAI

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

#### CDP

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

Without `createAuthHeaders`, CDP rejects every verify call with 401 or 403 and the gate returns 502.

#### Defaults and settlement

Both gates default to USDC on Base mainnet, `maxTimeoutSeconds: 60`, and the description `"Tool invocation"`. `network: "base-sepolia"` works for testing. Any default, including `facilitatorUrl`, can be overridden in the config.

The gate verifies payment before your handler runs. After the handler succeeds and its output validates, the gate calls the facilitator's `/settle`, and USDC moves from payer to `recipient`. The settlement tx hash lands on `ctx.gates.x402.settlementTxHash`.

Settlement is synchronous: the response waits for `/settle`, so a slow facilitator can add up to 10 seconds (the per-call timeout). Non-blocking settlement would need runtime-specific `waitUntil`, and fire-and-forget can lose settlements when a serverless process is killed after responding. If you need lower latency, wire your runtime's `waitUntil` into a wrapper gate yourself.

When `/settle` fails, the SDK logs `[tool-sdk] gate.settle failed:` with `console.error`. What the caller gets depends on the `settlement` option of `createToolHandler`:

- `"required"` (default) withholds the output and returns `502 { error: "Payment settlement failed" }`, since the caller was not charged. With several settling gates, an earlier one may have settled before a later one failed, so prefer a single settling gate.
- `"best-effort"` returns the handler's output with a 200. Use it only if you replay failed settlements out-of-band from the logged payment payload. A settlement that failed because the nonce was already spent can never be replayed.

### x402 gate (custom facilitator)

`x402Gate` takes a `verifyPayment` callback, for running your own facilitator or verifying payments without an HTTP round trip.

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

Without `verifyPayment`, every request that carries `X-Payment` gets a 501. Use `payaiX402Gate` or `cdpX402Gate` unless you have a reason to run your own facilitator.

### Client-side x402

Helpers for callers of x402-gated tools.

#### `signX402Payment`

Signs a USDC `TransferWithAuthorization` and returns the base64 `X-Payment` header value. The viem `Account` must support `signTypedData` (for example `privateKeyToAccount`).

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

A `fetch` wrapper that handles 402, signs, and replays. Non-402 responses pass through unchanged.

`paidFetch` takes the recipient, token, and amount from the server's 402, so constrain what it will sign with `maxAmount`, `allowedRecipients`, and `allowedAssets`. By default it requires the network's known USDC contract as the asset and rejects a `payTo` that is the zero address or a known burn address.

```typescript
import { paidFetch, USDC_BASE_ADDRESS } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount("0x...")
const res = await paidFetch("https://tool.example.com/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "what is this NFT worth?" }),
  signer: account,
  // Optional safety caps:
  maxAmount: "100000",                          // reject if server asks for more than 0.10 USDC
  allowedRecipients: ["0xYourTrustedPayee"],    // reject unknown payTo addresses
  allowedAssets: [USDC_BASE_ADDRESS],           // defaults to the known USDC contract per network
  idempotencyKey: orderId,                      // a retry with the same key settles at most once
})
const data = await res.json()
```

Without `idempotencyKey`, each call signs a fresh EIP-3009 nonce, so retrying after a lost response or a crash can pay twice. With a key, the nonce is derived from it (`idempotencyNonce(key)`), and the token settles a given nonce at most once per payer. Nonces are per token contract per chain, so a key requires `allowedAssets` to be exactly one USDC contract (`USDC_BASE_ADDRESS` or `USDC_BASE_SEPOLIA_ADDRESS`), and `paidFetch` refuses challenges on any other network. Use one key per logical purchase, such as a UUID stored with the order. `paidAuthenticatedFetch` takes the same option. To let a deduplicating seller return the original result, also send your own `Idempotency-Key` header.

## Usage reporting

The SDK can report each invocation to OpenSea (`POST /api/v2/tools/usage`). The reported caller is always one the tool verified: the onchain payer for paid x402 calls, or the caller's own EIP-3009 authorization for calls through `predicateGate`. The tool server never signs for the caller.

### Setup

1. Get an API key at [docs.opensea.io/reference/api-keys](https://docs.opensea.io/reference/api-keys) and export it:

```bash
export OPENSEA_API_KEY="your-api-key"
```

2. Add `usageReporting` to the handler config. Free (EIP-3009) and paid (x402) calls are both reported:

```typescript
import { createToolHandler } from "@opensea/tool-sdk"

const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [/* x402 paywall and/or predicateGate */],
  handler: async (input, ctx) => {
    // your tool logic
  },
  usageReporting: {
    chainId: 8453,                // chain for the EIP-712 USDC domain / x402 fallback
    toolChainId: 8453,            // ERC-8257: chain where the tool is registered
    toolRegistryAddress: "0x...", // ERC-8257: registry contract
    toolOnchainId: 42,            // ERC-8257: tool ID in the registry
    apiKey: process.env.OPENSEA_API_KEY!,
  },
})
```

The `apiKey` authenticates you, the operator, as the reporter. The caller is identified from data they already sent, so no caller wallet or `walletClient` is involved.

The report runs last, after the output is computed and gates have settled. When the runtime has a `waitUntil` (detected on Vercel, wired by `toCloudflareHandler`, or passed as `waitUntil` in the config), the report is registered there and the response returns without waiting. Otherwise the handler awaits it, bounded by `timeoutMs` (default 5s), so it completes before a serverless runtime freezes. Reporter failures are logged and never fail the call. If settlement fails under `settlement: "required"`, no report is sent.

### What gets reported

- Paid x402 calls report `verification_type: "x402_settlement"` with the payer address and settlement tx hash. The backend verifies the settlement directly.
- EIP-3009 calls (for example behind `predicateGate`) report `verification_type: "eip3009_authorization"` and forward the caller's original zero-value `TransferWithAuthorization` (USDC domain, `value = 0`). The caller signed it to authenticate, so the reported identity is the caller, not the server. No tokens move.

### Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `chainId` | Yes | Chain for the EIP-712 USDC domain and the x402 `chain_id` fallback (1, 8453, 137, 42161, 10, 43114) |
| `toolChainId` | Yes | ERC-8257 composite key: chain of registration |
| `toolRegistryAddress` | Yes | ERC-8257 composite key: registry contract |
| `toolOnchainId` | Yes | ERC-8257 composite key: numeric tool ID |
| `apiKey` | Yes | OpenSea API key ([get one](https://docs.opensea.io/reference/api-keys)), identifying the tool service as reporter |
| `aggregatorUrl` | No | Endpoint override (default `https://api.opensea.io/api/v2/tools/usage`) |
| `timeoutMs` | No | Request timeout in ms (default 5000) |

### Standalone reporters

To report from outside the handler, such as a separate pipeline, call the reporters directly.

The EIP-3009 reporter forwards an authorization your auth layer already verified, passed as `callerAuthorization` on the `InvocationEvent`:

```typescript
import { createEip3009UsageReporter } from "@opensea/tool-sdk"

const reportUsage = createEip3009UsageReporter({
  chainId: 8453,
  toolChainId: 8453,
  toolRegistryAddress: "0x...",
  toolOnchainId: 42,
  apiKey: process.env.OPENSEA_API_KEY!,
})

await reportUsage({
  paid: false,
  latencyMs: 123,
  timestamp: Date.now(),
  callerAuthorization, // the caller's verified zero-value authorization
})
```

The x402 reporter sends the settlement tx hash and needs no signing:

```typescript
import { createX402UsageReporter } from "@opensea/tool-sdk"

const reportX402Usage = createX402UsageReporter({
  toolChainId: 8453,
  toolRegistryAddress: "0x...",
  toolOnchainId: 42,
  apiKey: process.env.OPENSEA_API_KEY!,
})

await reportX402Usage({
  callerAddress: "0x...",
  txHash: "0x...",
  chainId: 8453,
  latencyMs: 200,
})
```

## Security considerations

### Input validation

`createToolHandler` checks every request before and after your handler:

1. Only `POST` is accepted (405 otherwise).
2. Malformed JSON returns 400.
3. The body must pass your Zod `inputSchema`, or the caller gets a 400 with structured error details.
4. The return value must pass `outputSchema`, or the caller gets a 500 that leaks no internal state.

`ToolManifestSchema` enforces HTTPS-only endpoints, lowercase hex addresses, bounded field lengths, JSON Schema depth limits, and cross-field rules (a `hardware-attested` tier requires an `attestation` block).

### Rate limiting

The SDK has no built-in rate limiter. The right mechanism depends on the platform, and in-memory counters do not work on serverless runtimes where each invocation may get its own isolate.

- Cloudflare Workers: [Rate Limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) at the edge, or [Durable Objects](https://developers.cloudflare.com/durable-objects/) for per-key counters.
- Vercel: [Vercel WAF rate limiting](https://vercel.com/docs/security/vercel-waf) or [Upstash Ratelimit](https://github.com/upstash/ratelimit) with Redis.
- Express or self-hosted: [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit), or a reverse proxy (nginx, Caddy) in front.

You can also write a `GateMiddleware` whose `check()` hook returns 429 when a limit is hit.

### Replay protection

`predicateGate` binds each zero-value authorization to the endpoint URL, tool ID, and operator through the signed EIP-3009 `to` field. `eip3009AuthenticatedFetch` checks that binding before signing, follows same-origin redirects, and rejects cross-origin redirects before any signature exists. A phishing endpoint therefore cannot collect a header that works on another tool, even one with the same operator.

Without `replayGuard`, the header stays reusable against its intended endpoint until `validBefore`. The guard atomically reserves the authorization's `(payer, nonce)` key before the handler runs. Its store must be shared across instances, and its TTL must cover the accepted authorization window. The SDK ships no default store; `skill/references/x402.md` has the interface and a Redis example.

### Sensitive data

- The SDK runtime never reads or stores raw private keys. Signing goes through the `WalletAdapter` interface from `@opensea/wallet-adapters` (Privy, Turnkey, Fireblocks, or a local key).
- `deploy` masks values of env vars whose names end in `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, or `_PRIVATE` during interactive prompts.
- `predicateGate` verifies EIP-3009 authorizations with `ecrecover` (no RPC call). It rejects a non-zero `value`, binds the signature to the endpoint URL, tool ID, and operator, pins it to the configured identity chain, and caps `validBefore` at 1 hour ahead. Add `replayGuard` for single-use semantics.
- `paidFetch` checks a 402 before signing: `maxAmount` caps the spend, `allowedRecipients` limits payees, and `allowedAssets` defaults to the network's USDC contract.

## Tips

### `ai@4` with `zod@4`

`ai@4` (Vercel AI SDK) expects a JSON Schema object from its own `jsonSchema()` helper. A `zod@4` schema passed to `generateObject`'s `schema` typechecks, but the result is typed `unknown`, because `ai@4` does not recognize Zod 4's schema brand. Give `ai` a hand-written JSON Schema and validate the result with Zod:

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

// 3. Validate at runtime: `object` is typed as `unknown` from ai@4
const parsed = MySchema.parse(object)
// `parsed` is now fully typed as { name: string; score: number }
```

## ERC spec

The [ERC-8257 Tool Registry specification](https://github.com/ethereum/ERCs/pull/1723) defines the manifest schema, origin binding, creator binding, and consumer verification.

## Contributing

Read-only mirror of a private monorepo, updated on each release. Pull requests are welcome, and we bring accepted changes into the monorepo.

## Security

Found a vulnerability? Report it through OpenSea's Bugcrowd program at https://bugcrowd.com/engagements/opensea rather than opening a public issue. See [SECURITY.md](SECURITY.md).
