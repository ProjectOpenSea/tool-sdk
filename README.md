# @opensea/tool-sdk

SDK and CLI for building [ERC-8257](https://github.com/ethereum/ERCs/pull/1723) compliant AI agent tools. Provides manifest validation, onchain registration, gating middleware, framework adapters, and project scaffolding.

Pairs with the onchain reference implementation at [ProjectOpenSea/tool-registry](https://github.com/ProjectOpenSea/tool-registry) — the `ToolRegistry` contract and example access predicates this SDK reads from and writes to.

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

Scaffold a new ERC-8257 tool project with interactive prompts.

```bash
npx @opensea/tool-sdk init my-tool
npx @opensea/tool-sdk init my-tool --no-interactive  # CI mode
```

Supports Vercel, Cloudflare Workers, and Express templates.

### `validate [path]`

Validate a tool manifest JSON file against the ERC-8257 schema. The schema is open: namespaced extension fields are allowed and preserved. The command warns about any bare (un-namespaced) extension fields, which should use a reverse-DNS prefix per ERC-8257.

```bash
npx @opensea/tool-sdk validate ./manifest.json
```

### `hash [path]`

Compute the JCS keccak256 hash of a tool manifest (RFC 8785 canonicalization).

```bash
npx @opensea/tool-sdk hash ./manifest.json
```

The hash is taken over the full manifest as served, per ERC-8257 §2: every field is included (including namespaced extension fields), and no fields are stripped or defaulted before hashing. Verifiers reproduce it by JCS-canonicalizing the manifest and hashing that, so the SDK and any other RFC 8785 implementation agree. The command prints any bare-extension warning to stderr, so the hash itself stays on stdout and piping is unaffected.

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
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--nft-gate <address>` | ERC-721 collection address; gates the tool via the canonical ERC721OwnerPredicate (version auto-detected from registry) |
| `--erc20-gate <address>` | ERC-20 token address; gates the tool via the canonical ERC20BalancePredicate. Requires `--erc20-min-balance`. Mutually exclusive with `--nft-gate` |
| `--erc20-min-balance <amount>` | Minimum token balance in raw units (e.g. `1000000000000000000` for 1e18). Required with `--erc20-gate` |
| `--access-predicate <address>` | Access predicate address (mutually exclusive with `--nft-gate` and `--erc20-gate`) |
| `--predicate-config <json>` | JSON config for the access predicate (e.g. `'{"collections":["0x..."]}'` or `'{"token":"0x...","minBalance":"1000000000000000000"}'`). Bundles predicate setup with registration |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint for gas estimation and tx broadcast |
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

Make a paid call to a tool endpoint via x402. Probes the endpoint for payment requirements (402 challenge), signs an EIP-3009 `TransferWithAuthorization` as the `X-Payment` header, and replays the request. Works for both paid and gated tools — the 402 challenge determines the payment amount (real USDC for paid, zero-value for identity-only gating).

```bash
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body (inline string or `@path/to/file.json`) |
| `--method <verb>` | HTTP method (defaults to POST; falls back to GET if a POST probe 404/405s) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--max-amount <baseUnits>` | Reject challenges charging more than this (token base units). Pass `unlimited` to disable |
| `--no-report-usage` | Disable the caller-side usage report sent to OpenSea after a successful payment |
| `--api-key <key>` | API key for usage reporting (falls back to `OPENSEA_API_KEY`, then an auto-provisioned instant key) |
| `--tool-ref <ref>` | Tool coordinates as `chainId,registryAddress,onchainId` (e.g. `8453,0x265b...2cf1,65`, or `8453,x402:bazaar,123` for x402 registries). Disambiguates usage reporting when multiple tools share one endpoint |

When an endpoint URL maps to more than one registered tool, an endpoint-only usage report is rejected with `400 Multiple tools registered for endpoint`. Pass `--tool-ref` so the report identifies the exact tool by its composite key. The fields are comma-separated so a registry identifier that contains a colon (such as the `x402:bazaar` / `x402:bankr` registries used for tools that are not registered onchain) stays unambiguous:

```bash
# Onchain (ERC-8257) registry:
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}' \
  --tool-ref 8453,0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1,65

# x402 registry (not registered onchain):
npx @opensea/tool-sdk pay https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}' \
  --tool-ref 8453,x402:bazaar,8679018179619845322
```

### `auth <url>`

Make an authenticated call to a predicate-gated tool endpoint via EIP-3009 zero-value authorization.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk auth https://my-tool.vercel.app/api/tool \
  --body '{"query":"hello"}'
```

| Flag | Description |
|------|-------------|
| `--body <json>` | JSON body (inline string or `@path/to/file.json`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |

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

Invoke a tool handler locally with no auth header and assert a valid challenge response (402 when `operatorAddress` is configured, 401 otherwise).

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

### `smoke`

Smoke-test a live tool endpoint: sign an EIP-3009 authorization, send an authenticated request, and assert the HTTP status. Classifies 402 as "auth passed, payment required" for paywalled tools.

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
| `--tool-id <id>` | Onchain tool ID (included in log output) |
| `--input <json>` | JSON body (inline or `@path`; default: `{}`) |
| `--expect <status>` | Expected HTTP status code |
| `--chain <name>` | Chain for wallet client and EIP-3009 signature (default: `base`) |
| `--paid` | Handle x402 payment challenge after EIP-3009 authentication |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--max-amount <amount>` | Maximum payment amount in base units (default: `1000000` = 1 USDC) |

### `set-collections <toolId> <addresses...>`

Set the ERC-721 collection gate list for an already-registered tool.

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk set-collections 4 \
  0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9 \
  --network base
```

| Flag | Description |
|------|-------------|
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint |
| `--dry-run` | Print encoded calldata without transacting |

### `get-collections <toolId>`

Read the ERC-721 collection gate list for a registered tool (read-only).

```bash
npx @opensea/tool-sdk get-collections 4 --network base
```

| Flag | Description |
|------|-------------|
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--rpc-url <url>` | RPC endpoint |

### `set-collection-tokens <toolId> <address> <tokenIds...>`

Set the ERC-1155 collection + token ID gate for an already-registered tool.

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk set-collection-tokens 4 \
  0xCOLLECTION_ADDRESS 1 2 3 \
  --network base
```

| Flag | Description |
|------|-------------|
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint |
| `--dry-run` | Print encoded calldata without transacting |

### `configure-subscription <toolId> <collection>`

Configure the SubscriptionPredicate gate for an already-registered tool.

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-subscription 4 \
  0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626 \
  --min-tier 0 --network base
```

| Flag | Description |
|------|-------------|
| `--min-tier <tier>` | Minimum subscription tier (uint8, 0-255; default: `0`) |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint |
| `--dry-run` | Print summary without transacting |

### `configure-trait-gating <toolId> <collection> <traitKey> <allowedValues...>`

Configure the TraitGatedPredicate gate for an already-registered tool. Uses ERC-721 ownership + ERC-7496 dynamic trait matching.

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-trait-gating 4 \
  0xNFT_COLLECTION tier Rare Legendary \
  --network base

# With a separate ERC-7496 traits/renderer contract:
PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-trait-gating 4 \
  0xNFT_COLLECTION tier Rare Legendary \
  --traits-contract 0xRENDERER --network base
```

| Flag | Description |
|------|-------------|
| `--predicate-address <address>` | Override the canonical TraitGatedPredicate address |
| `--traits-contract <address>` | ERC-7496 traits contract address (defaults to collection if omitted) |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint |
| `--dry-run` | Print summary without transacting |

**Bytes32 encoding:** `traitKey` and `allowedValues` are encoded as left-aligned, zero-padded bytes32 values. They must match exactly how the traits contract stores them. `bytes32(0)` is not allowed in `allowedValues` (it is the default return for unset traits).

### `get-trait-config <toolId>`

Read the trait gating configuration for a registered tool (read-only).

```bash
npx @opensea/tool-sdk get-trait-config 4 --network base
```

| Flag | Description |
|------|-------------|
| `--predicate-address <address>` | Override the canonical TraitGatedPredicate address |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--rpc-url <url>` | RPC endpoint |

### `configure-erc20-gate <toolId> <token> <minBalance>`

Configure the ERC20BalancePredicate gate for an already-registered tool. Requires the caller to be the tool creator.

```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk configure-erc20-gate 4 \
  0xTOKEN_ADDRESS 1000000000000000000 \
  --network base
```

| Flag | Description |
|------|-------------|
| `--predicate-address <address>` | Override the canonical ERC20BalancePredicate address |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--wallet-provider <provider>` | Wallet provider to use for signing |
| `--rpc-url <url>` | RPC endpoint |
| `--dry-run` | Print summary without transacting |

### `get-erc20-config <toolId>`

Read the ERC-20 balance gating configuration for a registered tool (read-only).

```bash
npx @opensea/tool-sdk get-erc20-config 4 --network base
```

| Flag | Description |
|------|-------------|
| `--predicate-address <address>` | Override the canonical ERC20BalancePredicate address |
| `--network <network>` | `base` or `mainnet` (default: `base`) |
| `--rpc-url <url>` | RPC endpoint |

## Wallet Configuration

All commands that sign transactions (`register`, `update-metadata`, `pay`, `auth`, `smoke`, `set-collections`, `set-collection-tokens`, `configure-subscription`, `configure-trait-gating`, `configure-erc20-gate`) need a wallet. You can configure one in two ways:

1. **Environment variables** — set the env vars for your provider and the CLI auto-detects it (priority: Privy > Fireblocks > Turnkey > Bankr > PrivateKey).
2. **`--wallet-provider` flag** — explicitly select a provider by name.

| Provider | `--wallet-provider` value | Required env vars |
|----------|--------------------------|-------------------|
| Privy | `privy` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` |
| Fireblocks | `fireblocks` | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET`, `FIREBLOCKS_VAULT_ID` |
| Turnkey | `turnkey` | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_WALLET_ADDRESS`, `TURNKEY_RPC_URL` |
| Bankr | `bankr` | `BANKR_API_KEY` |
| Private Key | `private-key` | `PRIVATE_KEY`, `RPC_URL` |

See [`.env.example`](.env.example) for a full annotated template.

### Examples

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

Type-narrowing identity function for manifest definitions.

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

Validates unknown data against the ERC-8257 manifest schema.

```typescript
import { validateManifest } from "@opensea/tool-sdk"

const result = validateManifest(jsonData)
if (result.success) {
  console.log(result.data.name)
} else {
  console.error(result.error.issues)
}
```

The schema is open: namespaced extension fields are preserved, and no defaults are injected, so the validated manifest still matches what gets served and hashed.

### `findBareExtensionKeys(data)`

Returns the top-level fields in `data` that are neither defined by the ERC-8257 schema nor namespaced as extensions (for example `paymentHint`). These fields are committed by the manifest hash since the manifest is hashed as served, but ERC-8257 requires extension fields to be namespaced (reverse-DNS, e.g. `io.opensea.paymentHint`, or the legacy `x-` prefix) so they cannot collide with future normative fields. Returns an empty array when `data` is not a JSON object.

```typescript
import { findBareExtensionKeys } from "@opensea/tool-sdk"

const bare = findBareExtensionKeys(jsonData)
if (bare.length > 0) {
  console.warn(`Namespace these extension fields: ${bare.join(", ")}`)
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
  gates: [], // optional: predicateGate, x402Gate
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

Computes the JCS keccak256 hash of a manifest (RFC 8785 canonicalization + keccak256). Per ERC-8257 §2 the manifest is hashed as served: pass the raw served or authored object (for example the fetched response body), with every field intact and no defaults injected. Do not pass a schema-stripped copy, or an independently computed hash will not match.

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

## Invocation Flow

For a visual walkthrough of the full 402 challenge-response lifecycle (identity verification, access check, payment settlement, and usage reporting), see [docs/tool-invocation-flow.md](docs/tool-invocation-flow.md).

## Gating

### Predicate Gate (recommended)

Delegates the access decision to the onchain `ToolRegistry`. When
`operatorAddress` is configured, the gate returns a 402 challenge with
`PaymentRequirements` (`maxAmountRequired: "0"`); the caller signs a
zero-value `X-Payment` and retries — the same flow as x402. The middleware
recovers the caller's address from the `X-Payment` signature via `ecrecover`
and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)`. Whatever
predicate the tool's creator registered (single-collection ERC-721,
multi-collection, ERC-1155, subscription, composite, anything future) is the
policy enforced.

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
| No auth, `operatorAddress` configured | `402` | `{ accepts: [{ payTo, maxAmountRequired: "0", scheme: "exact", ... }] }` |
| No auth, no `operatorAddress` | `401` | `{ error, hint }` |
| Malformed auth header or `X-Payment` | `401` | `{ error }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "Predicate misbehaved..." }` |

The `predicate` field in the 403 body is the registered access predicate's
address, fetched lazily from `getToolConfig` on first denial and cached
in-process. Callers can read the predicate's onchain config to learn what
they need to satisfy.

Preferred auth mechanism: `X-Payment` header (zero-value EIP-3009 `TransferWithAuthorization` via the 402 challenge flow). Also accepts `Authorization: EIP-3009 <base64url(json)>` and deprecated `SIWE <base64url(message)>.<signature>` for backward compatibility.

> **Note:** The gate enforces a short-lived `validBefore` window (the SDK
> defaults to 5 minutes). Each authorization includes a random nonce bound
> into the signature. The gate does not track nonces server-side.

#### Delegated agent access (delegate.xyz)

An AI agent can call a predicate-gated tool **on behalf of** an NFT holder
without the holder's private key. The holder delegates to the agent at
[delegate.xyz](https://delegate.xyz) (onchain, one TX, revocable anytime),
and the agent includes the holder's address in the request:

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

When `X-Delegate-For` is present, the middleware:

1. Verifies the agent's identity (via `X-Payment` or `Authorization: EIP-3009`) normally
2. Calls `checkDelegateForAll(agent, holder)` on the [delegate.xyz DelegateRegistry](https://docs.delegate.xyz)
3. If valid, runs the access predicate against the **holder** (not the agent)
4. Sets `ctx.callerAddress = holderAddress` and `ctx.agentAddress = agentAddress`

| Outcome | Status | Body |
| --- | --- | --- |
| Invalid `X-Delegate-For` format | `400` | `{ error }` |
| Delegation not found onchain | `403` | `{ error, hint }` |
| Delegate registry call failed | `502` | `{ error }` |

See [docs/predicate-gating-guide.md](docs/predicate-gating-guide.md) for the
full delegation walkthrough.

### Client-side access preview

Off-chain helper for clients that want to gate UI before invocation. Same
staticcall as `predicateGate`, no authentication required.

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

Gate your tool using the onchain access predicate system. When `operatorAddress` is configured, `predicateGate` uses a unified 402 challenge flow: it returns `PaymentRequirements` with `maxAmountRequired: "0"`, the caller signs a zero-value `X-Payment`, and the middleware recovers the caller's address via `ecrecover`. Access is then delegated to `IToolRegistry.tryHasAccess` — it works with ERC721OwnerPredicate, ERC1155OwnerPredicate, SubscriptionPredicate, ERC20BalancePredicate, CompositePredicate, or any future predicate automatically.

#### Combined predicate + payment (`paidPredicateGate`)

For tools that require **both** predicate access and x402 payment, use `paidPredicateGate` to resolve identity and payment in a single 402 round trip (2 requests instead of 3):

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

The gate advertises the real payment amount in the 402 challenge. The caller's `X-Payment` signature proves identity (`from`) AND authorizes payment in one step. The predicate is verified before payment settles — if access is denied, no funds move.

See [docs/predicate-gating-guide.md](docs/predicate-gating-guide.md) for the full setup walkthrough.

## Usage Reporting

Report tool invocations to OpenSea's analytics endpoint (`POST /api/v2/tools/usage`). For each call the SDK reports the **verified caller**: the on-chain **payer** for paid x402 calls, or the caller's **own EIP-3009 authorization** for calls authenticated by `predicateGate`. A tool server never signs on the caller's behalf.

### Setup

1. **Get an API key** at [docs.opensea.io/reference/api-keys](https://docs.opensea.io/reference/api-keys) and set it in your environment:

```bash
export OPENSEA_API_KEY="your-api-key"
```

2. **Add `usageReporting` to your handler config** — both free (EIP-3009 auth) and paid (x402) invocations are reported automatically:

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

> **Reporting is the service's job, never the caller's.** The `apiKey` authenticates *you* (the operator) as the reporter. The caller is identified by data they already supplied (the x402 payer, or the EIP-3009 authorization `predicateGate` verified), so no caller wallet, signing, or `walletClient` is involved.

That's it: the handler runs the reporter at the very end of the lifecycle, after the output is computed and gates have settled. It is **awaited** before the response is returned (bounded by the reporter's `timeoutMs`, default 5s) so the report reliably completes even on serverless runtimes that freeze the function the moment the response flushes. Reporter failures are caught and logged; they never fail the tool call.

### How it works

- **Paid (x402) calls** report `verification_type: "x402_settlement"` with the on-chain payer address and the settlement transaction hash. The backend verifies the settlement directly, so no signature is needed.
- **EIP-3009-authenticated calls** (e.g. behind `predicateGate`) report `verification_type: "eip3009_authorization"` by **forwarding the caller's original zero-value `TransferWithAuthorization`** (USDC domain, `value = 0`). The caller already signed it to authenticate; the SDK passes that exact signature through, so the reported identity is the real caller, not the server. No tokens are transferred.

### Configuration reference

| Field | Required | Description |
|-------|----------|-------------|
| `chainId` | Yes | Chain ID for the EIP-712 USDC domain / x402 `chain_id` fallback (1, 8453, 137, 42161, 10, 43114) |
| `toolChainId` | Yes | ERC-8257 composite key: chain of registration |
| `toolRegistryAddress` | Yes | ERC-8257 composite key: registry contract |
| `toolOnchainId` | Yes | ERC-8257 composite key: numeric tool ID |
| `apiKey` | Yes | OpenSea API key ([get one here](https://docs.opensea.io/reference/api-keys)). Authenticates the tool service as the reporter |
| `aggregatorUrl` | No | Override endpoint URL (default: `https://api.opensea.io/api/v2/tools/usage`) |
| `timeoutMs` | No | Request timeout in ms (default: 5000) |

### Standalone Reporters

If you report usage outside the handler flow (a custom pipeline or a separate reporting service), use the standalone reporter functions directly.

#### EIP-3009 Reporter

Forwards a caller's already-collected EIP-3009 authorization. Pass an `InvocationEvent` whose `callerAuthorization` holds the authorization your auth layer verified:

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

#### x402 Settlement Reporter

For paid tools using x402, report usage with the onchain settlement transaction hash — no wallet signing needed:

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

## Security Considerations

### Input Validation

`createToolHandler` validates every request automatically:

1. **Method check** — only `POST` is accepted (405 otherwise).
2. **Body parsing** — malformed JSON returns 400.
3. **Input schema** — the request body is validated against your Zod `inputSchema` before reaching your handler. Invalid payloads return 400 with structured error details.
4. **Output schema** — handler return values are validated against `outputSchema` before being sent. Schema mismatches return 500 without leaking internal state.

The `ToolManifestSchema` enforces structural invariants on manifests: HTTPS-only endpoints, lowercase hex addresses, bounded field lengths, JSON Schema depth limits, and cross-field consistency (e.g. `hardware-attested` tier requires an `attestation` block).

### Rate Limiting

The SDK does not ship a built-in rate limiter. Rate limiting is inherently deployment-specific — Cloudflare Workers, Vercel, AWS API Gateway, and self-hosted Node all have different preferred mechanisms, and in-memory counters do not work in serverless environments where each invocation may run in a separate isolate.

Recommended approaches by platform:

- **Cloudflare Workers** — [Rate Limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) at the edge, or [Durable Objects](https://developers.cloudflare.com/durable-objects/) for per-key counters.
- **Vercel** — [Vercel WAF rate limiting](https://vercel.com/docs/security/vercel-waf) or [Upstash Ratelimit](https://github.com/upstash/ratelimit) with Redis.
- **Express / self-hosted** — [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) or a reverse proxy (nginx, Caddy) in front of your process.

You can also implement a custom `GateMiddleware` that performs rate-limit checks in the `check()` hook and returns a 429 response when limits are exceeded.

### Sensitive Data Handling

- **Private keys** are never handled directly by the SDK runtime. They flow through `@opensea/wallet-adapters`, which supports Privy, Turnkey, Fireblocks, and local key signing. The SDK accepts a `WalletAdapter` interface — it never reads or stores raw key material.
- **Environment variables** — the `deploy` command detects sensitive env vars (names ending in `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, `_PRIVATE`) and masks their values during interactive prompts.
- **EIP-3009 auth** — the `predicateGate` middleware verifies EIP-3009 zero-value authorizations via `ecrecover` (no RPC call needed). The SDK defaults to a 5-minute `validBefore` window to limit replay.
- **x402 payments** — the `paidFetch` client validates payment parameters before signing: `maxAmount` caps the spend, `allowedRecipients` restricts payees, and `allowedAssets` defaults to the canonical USDC contract for the network. These guard against malicious 402 responses.

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

See the full [ERC-8257 Tool Registry specification](https://github.com/ethereum/ERCs/pull/1723) for details on manifest schema, origin binding, creator binding, and consumer verification.
