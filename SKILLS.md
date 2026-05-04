# Tool SDK — Agent Skills

Use this playbook when you need to:
- **Build** an AI-callable tool endpoint (HTTPS + JSON Schema + `.well-known` manifest)
- **Register** a tool onchain so other agents can discover it via the ToolRegistry
- **Gate access** to a tool using NFT ownership, subscriptions, or pay-per-call (x402/USDC)
- **Call** a gated tool — handle 402 payment challenges and 403 predicate auth

This SDK is for tool *providers and consumers*. If you just want to query OpenSea marketplace data (floor prices, listings, trades), use the [opensea skill](https://github.com/ProjectOpenSea/opensea-skill) instead.

---

## Concepts

| Term | Meaning |
|------|---------|
| **Tool** | An HTTPS endpoint with a JSON Schema interface, discoverable via `/.well-known/ai-tool/<slug>.json` |
| **Manifest** | JCS-canonicalized JSON describing the tool's name, endpoint, inputs, outputs, pricing, and access policy |
| **ToolRegistry** | Onchain contract (Base) where tools are registered with a manifest hash and optional access predicate |
| **Access Predicate** | An `IAccessPredicate` contract that gates who can invoke a tool (NFT ownership, subscriptions, composites) |
| **x402** | HTTP 402-based pay-per-call protocol — the caller signs a USDC `TransferWithAuthorization` and the server settles after execution |
| **SIWE** | Sign-In with Ethereum (EIP-4361) — used to authenticate callers for predicate-gated tools |
| **Facilitator** | Third-party service that verifies and settles x402 payments (PayAI or Coinbase CDP) |

---

## Deployed Contracts (Base mainnet)

| Contract | Address |
|----------|---------|
| ToolRegistry (v0.1) | `0x7291BbFbC368C2D478eCe1eA30de31F612a34856` |
| ERC721OwnerPredicate (v0.2) | `0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769` |
| ERC1155OwnerPredicate (v0.2) | `0xc179b9d4D9B7ffe0CdA608134729f72003380A7e` |

---

## 1. Create a Tool

### 1a. Scaffold a project

```bash
npx @opensea/tool-sdk init --runtime vercel   # or: cloudflare, express
```

This generates:
- `src/manifest.ts` — tool manifest definition
- `src/handler.ts` — request handler with input/output schemas
- `api/index.ts` — framework adapter entry point
- `public/llms.txt` — agent-readable discovery page
- `api/well-known/[slug].ts` — serves the manifest at `/.well-known/ai-tool/<slug>.json`

### 1b. Define the manifest

```typescript
import { defineManifest } from "@opensea/tool-sdk"

export const manifest = defineManifest({
  name: "My Tool",
  description: "What this tool does",
  endpoint: "https://my-tool.example.com/api",
  creatorAddress: "0xYOUR_WALLET_ADDRESS",
  inputs: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  outputs: {
    type: "object",
    properties: {
      result: { type: "string" },
    },
  },
  // Optional: add pricing for x402 paywall (see Section 3)
  // pricing: paywall.pricing,
  // Optional: add access requirements (see Section 4)
  // access: { logic: "OR", requirements: [...] },
})
```

### 1c. Write the handler

```typescript
import { createToolHandler } from "@opensea/tool-sdk"
import { z } from "zod/v4"
import { manifest } from "./manifest.js"

const InputSchema = z.object({ query: z.string() })
const OutputSchema = z.object({ result: z.string() })

export const toolHandler = createToolHandler({
  manifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  // gates: [],  // Add gates here (see Sections 3 and 4)
  handler: async (input) => {
    return { result: `Processed: ${input.query}` }
  },
})
```

### 1d. Wire up the adapter

**Vercel:**
```typescript
import { toVercelHandler } from "@opensea/tool-sdk"
import { toolHandler } from "../src/handler.js"
export default toVercelHandler(toolHandler)
```

**Express:**
```typescript
import { toExpressHandler } from "@opensea/tool-sdk"
import { toolHandler } from "./handler.js"
app.post("/api", toExpressHandler(toolHandler))
```

**Cloudflare Workers:**
```typescript
import { toolHandler } from "./handler.js"
export default { fetch: toolHandler }
```

---

## 2. Register a Tool Onchain

### 2a. Via CLI

```bash
# Set up wallet
export PRIVATE_KEY=0x...
export RPC_URL=https://mainnet.base.org

# Register (open access — no predicate)
npx @opensea/tool-sdk register \
  --metadata https://my-tool.example.com/.well-known/ai-tool/my-tool.json \
  --network base

# Register with NFT gate (ERC-721 collection)
npx @opensea/tool-sdk register \
  --metadata https://my-tool.example.com/.well-known/ai-tool/my-tool.json \
  --network base \
  --nft-gate 0xCOLLECTION_ADDRESS

# Register with a custom access predicate
npx @opensea/tool-sdk register \
  --metadata https://my-tool.example.com/.well-known/ai-tool/my-tool.json \
  --network base \
  --access-predicate 0xPREDICATE_ADDRESS

# Dry run (no transaction)
npx @opensea/tool-sdk register --metadata ... --network base --dry-run
```

The CLI:
1. Fetches the manifest from `--metadata` URL
2. Validates the manifest schema
3. Verifies `manifest.creatorAddress` matches your wallet
4. Computes the JCS keccak256 manifest hash
5. Calls `ToolRegistry.registerTool(metadataURI, manifestHash, accessPredicate)`
6. Returns the `toolId` from the `ToolRegistered` event

### 2b. Via SDK (programmatic)

```typescript
import { ToolRegistryClient, computeManifestHash } from "@opensea/tool-sdk"
import { createWalletFromEnv, walletAdapterToClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const walletClient = await walletAdapterToClient(adapter, base)

const registry = new ToolRegistryClient({
  chain: base,
  rpcUrl: "https://mainnet.base.org",
  walletClient,
})

const { toolId, txHash } = await registry.registerTool({
  metadataURI: "https://my-tool.example.com/.well-known/ai-tool/my-tool.json",
  manifest,                                      // your ToolManifest object
  accessPredicate: "0x0000...0000",              // address(0) = open access
})

console.log(`Registered tool ${toolId} in tx ${txHash}`)
```

---

## 3. x402 Payment-Gated Tools (Pay-per-Call)

### How x402 works

```
Agent                        Tool Server                   Facilitator
  |--- POST /api ------------->|                                |
  |<-- 402 + requirements -----|                                |
  |                            |                                |
  |  (sign EIP-3009 USDC       |                                |
  |   TransferWithAuthorization)|                               |
  |                            |                                |
  |--- POST /api ------------->|                                |
  |    X-Payment: <base64>     |--- POST /verify -------------->|
  |                            |<-- { isValid: true } ----------|
  |                            |                                |
  |                            |  (execute tool handler)        |
  |                            |                                |
  |                            |--- POST /settle -------------->|
  |                            |<-- { success, txHash } --------|
  |<-- 200 + result -----------|                                |
```

1. Agent calls the tool endpoint without payment
2. Server returns `402` with `accepts[]` containing payment requirements (amount, asset, recipient, network)
3. Agent signs an EIP-3009 `TransferWithAuthorization` for the requested USDC amount
4. Agent retries the request with the `X-Payment` header containing the base64-encoded signed payload
5. Server verifies the payment via the facilitator's `/verify` endpoint
6. Server executes the tool handler
7. Server settles the payment via the facilitator's `/settle` endpoint
8. Server returns the result

### 3a. Build a tool with x402 paywall (server side)

Use `defineToolPaywall` to keep the manifest price and the gate's enforced price in sync:

```typescript
import { createToolHandler, defineToolPaywall, defineManifest } from "@opensea/tool-sdk"
import { z } from "zod/v4"

// 1. Define paywall config (single source of truth for price)
const paywall = defineToolPaywall({
  recipient: "0xYOUR_WALLET_ADDRESS",  // where USDC is sent
  amountUsdc: "0.01",                  // price per call in USDC
  // network: "base",                  // default: "base" (or "base-sepolia" for testnet)
  // facilitator: "payai",             // default: "payai" (or "cdp" for Coinbase)
})

// 2. Include pricing in the manifest
const manifest = defineManifest({
  name: "My Paid Tool",
  description: "A tool that costs $0.01 per call",
  endpoint: "https://my-tool.example.com/api",
  creatorAddress: "0xYOUR_WALLET_ADDRESS",
  inputs: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputs: { type: "object", properties: { result: { type: "string" } } },
  pricing: paywall.pricing,  // <-- advertised in manifest
})

// 3. Add the gate to the handler
export const toolHandler = createToolHandler({
  manifest,
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [paywall.gate],     // <-- enforced at runtime
  handler: async (input) => ({ result: `Paid result: ${input.query}` }),
})
```

**Facilitator options:**

| Facilitator | Function | Auth required | Best for |
|-------------|----------|---------------|----------|
| PayAI | `payaiX402Gate()` | No | Prototyping, free to use |
| Coinbase CDP | `cdpX402Gate()` | Yes (JWT via `createAuthHeaders`) | Production |

For lower-level control, use `payaiX402Gate()` or `cdpX402Gate()` directly instead of `defineToolPaywall()`.

### 3b. Call an x402-paid tool (agent/client side)

**Via CLI:**
```bash
PRIVATE_KEY=0x... npx @opensea/tool-sdk pay \
  https://my-tool.example.com/api \
  --body '{"query": "hello"}'
```

**Via SDK — `paidFetch`:**
```typescript
import { paidFetch, createWalletFromEnv } from "@opensea/tool-sdk"

const adapter = createWalletFromEnv()  // reads PRIVATE_KEY from env

const res = await paidFetch("https://my-tool.example.com/api", {
  signer: adapter,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  // Safety guards:
  maxAmount: "100000",             // max 0.10 USDC (in 6-decimal base units)
  allowedRecipients: ["0x..."],    // only pay this address
})

const data = await res.json()
```

`paidFetch` automatically:
1. Makes the initial request
2. Parses the 402 response for payment requirements
3. Validates requirements against your safety guards (`maxAmount`, `allowedRecipients`, `allowedAssets`)
4. Signs the EIP-3009 `TransferWithAuthorization`
5. Retries with the `X-Payment` header

**Via raw HTTP (any language):**
```
POST /api HTTP/1.1
Host: my-tool.example.com
Content-Type: application/json

{"query": "hello"}
```
If the response is `402`, read `body.accepts[0]` for payment requirements, sign the USDC transfer authorization, base64-encode the payment payload, and retry with `X-Payment: <base64>`.

---

## 4. Predicate-Gated Tools (403 Access Control)

### How predicate gating works

```
Agent                        Tool Server                   ToolRegistry (onchain)
  |--- POST /api ------------->|                                |
  |    Authorization: SIWE ... |                                |
  |                            |  (verify SIWE signature)       |
  |                            |--- staticcall tryHasAccess --->|
  |                            |    (toolId, callerAddr, data)  |
  |                            |<-- (ok=true, granted=true) ----|
  |                            |                                |
  |                            |  (execute tool handler)        |
  |<-- 200 + result -----------|                                |
```

1. Agent builds a SIWE message for the tool's domain and signs it
2. Agent sends `Authorization: SIWE <base64url(message)>.<signature>`
3. Server verifies the SIWE signature and recovers the caller's address
4. Server calls `ToolRegistry.tryHasAccess(toolId, callerAddress, data)` which delegates to the tool's configured `IAccessPredicate`
5. If access is granted → execute handler → return 200
6. If access is denied → return 403 with predicate address for self-diagnosis
7. If predicate misbehaved → return 502

### 4a. Build a predicate-gated tool (server side)

```typescript
import { createToolHandler, predicateGate, defineManifest } from "@opensea/tool-sdk"
import { z } from "zod/v4"

const manifest = defineManifest({
  name: "Gated Tool",
  description: "Only accessible to NFT holders",
  endpoint: "https://my-tool.example.com/api",
  creatorAddress: "0xYOUR_WALLET_ADDRESS",
  inputs: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputs: { type: "object", properties: { result: { type: "string" } } },
  // Declare access requirements in the manifest so agents can discover
  // what they need before calling (see "Known Predicates" below)
  access: {
    logic: "OR",
    requirements: [
      {
        kind: "0xbdf8c428",  // IERC721Holding interface ID
        data: "0x000000000000000000000000YOUR_COLLECTION_ADDRESS",  // abi.encode(address)
        label: "Hold any NFT from My Collection",
      },
    ],
  },
})

export const toolHandler = createToolHandler({
  manifest,
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [
    predicateGate({
      toolId: 1n,  // your onchain tool ID from registration
      // chain: base,
      // rpcUrl: "https://mainnet.base.org",
    }),
  ],
  handler: async (input, ctx) => {
    // ctx.callerAddress is set after successful predicate check
    return { result: `Hello ${ctx.callerAddress}, result: ${input.query}` }
  },
})
```

### 4b. Call a predicate-gated tool (agent/client side)

**Via CLI:**
```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk auth \
  https://my-tool.example.com/api \
  --body '{"query": "hello"}'
```

**Via SDK — `authenticatedFetch`:**
```typescript
import { authenticatedFetch, createWalletFromEnv, walletAdapterToClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const client = await walletAdapterToClient(adapter, base)

const res = await authenticatedFetch("https://my-tool.example.com/api", {
  account: client.account,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  // expirationMinutes: 5,   // SIWE message TTL (max 60, default 5)
  // chainId: 8453,           // default: Base
})

const data = await res.json()
```

**Check access before calling (preview):**
```typescript
import { checkToolAccess } from "@opensea/tool-sdk"

const { ok, granted } = await checkToolAccess({
  toolId: 1n,
  account: "0xYOUR_WALLET",
  // chain: base,
  // rpcUrl: "https://mainnet.base.org",
})

if (!ok) console.error("Predicate misbehaved")
else if (!granted) console.error("Access denied — you don't meet the requirements")
else console.log("Access granted — safe to call")
```

### 4c. Handling 403 responses

When the predicate denies access, the server returns:
```json
{
  "error": "Predicate gate: access predicate denied",
  "toolId": "1",
  "predicate": "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769"
}
```

The `predicate` address tells the agent which predicate contract to inspect. Agents can call `IAccessPredicate.getRequirements(toolId)` to discover what's needed:

```typescript
import { IAccessPredicateABI } from "@opensea/tool-sdk"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"

const client = createPublicClient({ chain: base, transport: http() })

const [requirements, logic] = await client.readContract({
  address: "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769",
  abi: IAccessPredicateABI,
  functionName: "getRequirements",
  args: [1n],  // toolId
})

// requirements: [{ kind: "0xbdf8c428", data: "0x...", label: "..." }]
// logic: 0 = AND, 1 = OR
```

---

## 5. Combined Gates (Predicate + x402)

Tools can require **both** SIWE authentication and x402 payment. The server runs gates sequentially: predicate first (identity), then x402 (payment).

### 5a. Server side

```typescript
import {
  createToolHandler,
  defineToolPaywall,
  predicateGate,
  defineManifest,
} from "@opensea/tool-sdk"
import { z } from "zod/v4"

const paywall = defineToolPaywall({
  recipient: "0xYOUR_WALLET",
  amountUsdc: "0.05",
})

export const toolHandler = createToolHandler({
  manifest: defineManifest({
    name: "Premium Gated Tool",
    description: "NFT holders pay $0.05 per call",
    endpoint: "https://my-tool.example.com/api",
    creatorAddress: "0xYOUR_WALLET",
    inputs: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    outputs: { type: "object", properties: { result: { type: "string" } } },
    pricing: paywall.pricing,
    access: {
      logic: "OR",
      requirements: [{
        kind: "0xbdf8c428",
        data: "0x000000000000000000000000COLLECTION_ADDRESS",
        label: "Hold NFT from collection",
      }],
    },
  }),
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [
    predicateGate({ toolId: 1n }),  // checked first
    paywall.gate,                    // checked second
  ],
  handler: async (input) => ({ result: input.query }),
})
```

### 5b. Client side — `paidAuthenticatedFetch`

```typescript
import { paidAuthenticatedFetch, createWalletFromEnv, walletAdapterToClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const client = await walletAdapterToClient(adapter, base)

const res = await paidAuthenticatedFetch("https://my-tool.example.com/api", {
  account: client.account,   // for SIWE signing
  signer: adapter,           // for x402 payment signing (can differ from account)
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  maxAmount: "100000",       // safety cap: 0.10 USDC
})
```

**Via CLI:**
```bash
# Smoke test auto-detects gate types
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk smoke \
  --endpoint https://my-tool.example.com/api \
  --expect 200
```

---

## 6. Known Predicates

These predicates are deployed on Base and available for any tool to use. They are multi-tenant: one deployment serves all tools, configured per `toolId`.

### ERC721OwnerPredicate

Grants access to holders of any configured ERC-721 collection (`balanceOf > 0`).

| Field | Value |
|-------|-------|
| Address | `0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769` |
| Requirement `kind` | `0xbdf8c428` (`IERC721Holding` interface ID) |
| Requirement `data` | `abi.encode(address collection)` |
| Logic | `OR` (any one collection suffices) |
| Max collections | 10 per tool |

**Register + configure via CLI:**
```bash
# Registers the tool with ERC721OwnerPredicate and configures the collection in one flow
npx @opensea/tool-sdk register \
  --metadata https://my-tool.example.com/.well-known/ai-tool/my-tool.json \
  --network base \
  --nft-gate 0xCOLLECTION_ADDRESS
```

**Configure via SDK (after registration):**
```typescript
import { ERC721OwnerPredicateClient, walletAdapterToClient, createWalletFromEnv } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const walletClient = await walletAdapterToClient(adapter, base)

const predicate = new ERC721OwnerPredicateClient({ walletClient })
await predicate.setCollections(toolId, [
  "0xCOLLECTION_1",
  "0xCOLLECTION_2",
])
```

**Manifest access declaration:**
```json
{
  "access": {
    "logic": "OR",
    "requirements": [
      {
        "kind": "0xbdf8c428",
        "data": "0x000000000000000000000000<collection-address-no-0x-prefix>",
        "label": "Hold any NFT from My Collection"
      }
    ]
  }
}
```

### ERC1155OwnerPredicate

Grants access to holders of specific `(collection, tokenId)` pairs across ERC-1155 collections.

| Field | Value |
|-------|-------|
| Address | `0xc179b9d4D9B7ffe0CdA608134729f72003380A7e` |
| Requirement `kind` | `0xcb429230` (`IERC1155Holding` interface ID) |
| Requirement `data` | `abi.encode(address collection, uint256 tokenId)` |
| Logic | `OR` (any one entry suffices) |
| Max collections | 10 per tool |
| Max token IDs | 16 per collection |

**Configure via SDK:**
```typescript
import { ERC1155OwnerPredicateClient, walletAdapterToClient, createWalletFromEnv } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const walletClient = await walletAdapterToClient(adapter, base)

const predicate = new ERC1155OwnerPredicateClient({ walletClient })
await predicate.setCollectionTokens(toolId, [
  { collection: "0xCOLLECTION_ADDRESS", tokenIds: [1n, 2n, 3n] },
])
```

**Manifest access declaration:**
```json
{
  "access": {
    "logic": "OR",
    "requirements": [
      {
        "kind": "0xcb429230",
        "data": "0x000000000000000000000000<collection-addr>0000000000000000000000000000000000000000000000000000000000000001",
        "label": "Hold token #1 from My ERC-1155 Collection"
      }
    ]
  }
}
```

### SubscriptionPredicate

Grants access based on ERC-5643 subscription NFTs with optional tier gating.

| Field | Value |
|-------|-------|
| Requirement `kind` | `0x44387cc2` (`ISubscription` interface ID) |
| Requirement `data` | `abi.encode(address collection, uint8 minTier)` |

**Configure via SDK (after deploying the predicate):**
```typescript
// 1. Register tool with subscriptionPredicate as the accessPredicate
const { toolId } = await registry.registerTool({
  metadataURI: "...",
  manifest,
  accessPredicate: subscriptionPredicateAddress,
})

// 2. Configure which subscription NFT gates the tool
// (call configureToolGating on the SubscriptionPredicate contract)
```

### CompositePredicate

Combines up to 3 leaf predicates under AND-all or OR-any with optional per-term negation.

| Field | Value |
|-------|-------|
| Max terms | 3 per composition |
| Operators | `ALL` (AND), `ANY` (OR) |
| Negation | Per-term `negate` flag |
| Fail behavior | Fail-closed (sub-call failure = `false` before negation) |

**Example: "owns ERC-721 X **OR** has active subscription Y"**
```
CompositePredicate.setComposition(toolId, Op.ANY, [
  { predicate: ERC721OwnerPredicate, negate: false },
  { predicate: SubscriptionPredicate, negate: false },
])
```

**Example: "owns ERC-721 X **AND NOT** owns ERC-1155 Z"**
```
CompositePredicate.setComposition(toolId, Op.ALL, [
  { predicate: ERC721OwnerPredicate, negate: false },
  { predicate: ERC1155OwnerPredicate, negate: true },
])
```

---

## 7. Wallet Setup

The SDK supports multiple wallet providers via `@opensea/wallet-adapters`. Set environment variables and the SDK auto-detects the provider:

| Provider | Env vars | Best for |
|----------|----------|----------|
| Private Key | `PRIVATE_KEY`, `RPC_URL` | Local dev, scripts |
| Privy | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` | Server wallets |
| Turnkey | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID` | Enterprise signing |
| Fireblocks | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET`, `FIREBLOCKS_VAULT_ACCOUNT_ID` | Institutional custody |
| Bankr | `BANKR_API_KEY` | Agent wallets (via HTTP API) |

```typescript
import { createWalletFromEnv } from "@opensea/tool-sdk"

// Auto-detects: Privy > Fireblocks > Turnkey > Bankr > PrivateKey
const adapter = createWalletFromEnv()
const address = await adapter.getAddress()
```

For Bankr (external signer):
```typescript
import { createBankrAccount } from "@opensea/tool-sdk"

const account = await createBankrAccount("your-bankr-api-key")
// Use with authenticatedFetch or paidAuthenticatedFetch
```

---

## 8. Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Parse the JSON body per the manifest's `outputs` schema |
| 400 | Invalid input | Fix request body to match the manifest's `inputs` schema |
| 401 | Missing/invalid SIWE auth | Sign a SIWE message and include `Authorization: SIWE <token>` |
| 402 | Payment required | Read `body.accepts[0]` for payment requirements, sign and retry with `X-Payment` |
| 403 | Access denied | Inspect `body.predicate` to discover what's needed; acquire the required token/subscription |
| 405 | Method not allowed | Use POST |
| 500 | Internal tool error | Retry or contact the tool creator |
| 502 | Predicate/facilitator error | The upstream predicate or payment facilitator misbehaved; retry later |

---

## 9. Quick Reference: CLI Commands

| Command | Purpose |
|---------|---------|
| `init` | Scaffold a new tool project |
| `validate` | Validate a manifest file |
| `hash` | Compute the JCS keccak256 hash of a manifest |
| `export` | Export the manifest as JSON |
| `register` | Register a tool onchain |
| `update-metadata` | Update a tool's metadata URI and manifest hash onchain |
| `inspect` | Look up a tool's onchain config by ID |
| `verify` | Verify a manifest against its onchain hash |
| `deploy` | Deploy a tool to Vercel |
| `auth` | Call a predicate-gated tool (SIWE) |
| `pay` | Call an x402-paid tool (USDC) |
| `smoke` | Auto-detect gate type and call |
| `dry-run-gate` | Simulate an x402 gate check locally |
| `dry-run-predicate-gate` | Simulate a predicate gate check locally |

All CLI commands accept `--wallet-provider privy|turnkey|fireblocks|private-key` or auto-detect from env vars.

---

## 10. End-to-End Examples

### Example A: Free open-access tool

```bash
# 1. Scaffold
npx @opensea/tool-sdk init --runtime vercel
# 2. Edit src/manifest.ts and src/handler.ts with your logic
# 3. Deploy
npx @opensea/tool-sdk deploy
# 4. Register (open access)
PRIVATE_KEY=0x... npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base
# 5. Call
curl -X POST https://my-tool.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{"query": "hello"}'
```

### Example B: x402 paid tool (pay-per-call only, no identity check)

```bash
# Server: add paywall gate (see Section 3a)
# Call via CLI:
PRIVATE_KEY=0x... npx @opensea/tool-sdk pay \
  https://my-tool.vercel.app/api \
  --body '{"query": "hello"}'
```

### Example C: NFT-gated tool (identity check, no payment)

```bash
# Register with NFT gate
PRIVATE_KEY=0x... npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --nft-gate 0xCOLLECTION

# Server: add predicateGate (see Section 4a)

# Call via CLI:
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk auth \
  https://my-tool.vercel.app/api \
  --body '{"query": "hello"}'
```

### Example D: NFT-gated + paid tool (both gates)

```bash
# Server: add both predicateGate and paywall.gate (see Section 5a)
# Call via CLI:
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk smoke \
  --endpoint https://my-tool.vercel.app/api \
  --expect 200
```
