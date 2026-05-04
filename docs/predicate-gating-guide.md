# Predicate-Gated Tools Guide

Gate your tool using the onchain access predicate system. Callers prove their identity by signing a [SIWE (Sign-In with Ethereum)](https://eips.ethereum.org/EIPS/eip-4361) message, and the SDK delegates the access decision to the `ToolRegistry` contract — whatever predicate the tool's creator registered is the policy enforced.

## Overview

The tool-sdk supports two independent gating mechanisms:

| Gate | Purpose | How it works |
|------|---------|--------------|
| **Predicate gate** | Identity-based access control | Caller signs a SIWE message; the middleware recovers the address and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)` to check the registered predicate. Supports [delegated agent access](#delegated-agent-access-delegatexyz) via `X-Delegate-For` header. |
| **x402 gate** | Payment-based access control | Caller includes an `X-Payment` header with a signed USDC transfer authorization; a facilitator verifies and settles the payment |

Use predicate gating when access should be tied to **who the caller is**. Use x402 when access should be tied to **per-call payment**. You can [combine both](#combining-predicate-gating-with-x402-payment).

### Architecture

`predicateGate` is **predicate-agnostic**. It works with any predicate registered against the `ToolRegistry`:

| Predicate | Use case |
|-----------|----------|
| `ERC721OwnerPredicate` | Gate to holders of one or more ERC-721 collections |
| `ERC1155OwnerPredicate` | Gate to holders of ERC-1155 tokens |
| `SubscriptionPredicate` | Gate to active subscribers (ERC-5643) |
| `CompositePredicate` | Combine multiple predicates with AND/OR logic |
| Future predicates | Any contract implementing `IAccessPredicate` works automatically |

Tool creators configure the predicate onchain (via `register --nft-gate`, `--access-predicate`, or direct contract calls). The `predicateGate` middleware picks it up at runtime — no code changes needed when the access policy changes.

The `ERC721OwnerPredicate` is deployed on Base at `0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88` (see `src/lib/onchain/chains.ts`).

## Prerequisites

- An access predicate configured onchain for your tool (e.g., an ERC-721 collection deployed on Base)
- Your tool already deployed and serving its manifest at a `/.well-known/ai-tool/<slug>.json` endpoint

## Step 1: Configure the gate in your handler

Add `predicateGate({ toolId })` to the `gates` array in `createToolHandler`. The `toolId` is the numeric ID returned from the `ToolRegistered` event when you registered your tool.

```typescript
import { z } from "zod/v4"
import {
  createToolHandler,
  defineManifest,
  predicateGate,
} from "@opensea/tool-sdk"

export const manifest = defineManifest({
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "my-gated-tool",
  description: "A tool gated by an onchain access predicate",
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
  creatorAddress: "0xYourWalletAddress",
})

const handler = createToolHandler({
  manifest,
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  gates: [
    predicateGate({
      toolId: 42n, // your onchain tool ID
      // rpcUrl is optional — defaults to https://mainnet.base.org
    }),
  ],
  handler: async (input, ctx) => {
    // ctx.callerAddress is the verified wallet address
    // ctx.gates.predicate.granted === true
    return { result: `Hello: ${ctx.callerAddress}` }
  },
})
```

The middleware (`src/lib/middleware/predicate-gate.ts`) does the following on each request:

1. Extracts the `Authorization: SIWE <token>` header
2. Decodes and parses the SIWE message
3. Validates domain binding, expiration, and not-before constraints
4. Verifies the signature via `verifySiweMessage`
5. Calls `registry.tryHasAccess(toolId, recoveredAddress, data)` — a staticcall to the onchain `ToolRegistry`
6. If `(ok=true, granted=true)`, sets `ctx.callerAddress` and `ctx.gates.predicate.granted = true`

Status code mapping:

| Outcome | Status | Body |
|---------|--------|------|
| Missing or malformed SIWE | `401` | `{ error, hint }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "predicate misbehaved..." }` |

The `predicate` field in the 403 body is the registered access predicate's address, so callers can self-diagnose what they need to satisfy.

The gate is **stateless** — it does not track nonces. Callers should include a short-lived `expirationTime` in their SIWE messages to limit the replay window.

### Local development with `nftGate` (deprecated)

If you are developing locally against an **unregistered** tool (no `toolId` yet), you can use the deprecated `nftGate` middleware to test ERC-721 gating without an onchain registration:

```typescript
import { nftGate } from "@opensea/tool-sdk"

// Local dev only — migrate to predicateGate after registration
const gate = nftGate({
  collection: "0xYourERC721CollectionAddress",
})
```

`nftGate` re-implements the ERC-721 ownership check off-chain against a single hardcoded collection address. For registered tools, always use `predicateGate` — it delegates to the onchain registry so the access policy cannot drift.

## Step 2: Register with `--nft-gate`

Register your tool onchain with the `--nft-gate` flag, passing your ERC-721 collection address:

```bash
TOOL_SDK_PRIVATE_KEY=0x... npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --nft-gate 0xYourERC721CollectionAddress
```

This executes a **two-transaction flow** (see `src/cli/commands/register.ts` lines 204–232):

1. **`registerTool`** — registers the tool in the `ToolRegistry` contract and sets `accessPredicate` to the canonical `ERC721OwnerPredicate` (`0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88`).
2. **`setCollections`** — calls `setCollections(toolId, [collectionAddress])` on the `ERC721OwnerPredicate` to configure which collections gate the tool.

If the first transaction succeeds but the second fails, the CLI prints a recovery command:

```
Tool is registered but ungated. Call setCollections(<toolId>, [<collectionAddress>]) manually.
```

Use `--dry-run` to preview the registration without sending transactions:

```bash
TOOL_SDK_PRIVATE_KEY=0x... npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --nft-gate 0xYourERC721CollectionAddress \
  --dry-run
```

For other predicate types (ERC-1155, subscription, composite), use `--access-predicate <address>` to set a custom predicate directly.

## Step 3: Verify the setup

After registration, use `inspect` to confirm the onchain state:

```bash
npx @opensea/tool-sdk inspect --tool-id <id> --network base
```

This reads the tool config from the `ToolRegistry` and displays:

- **Creator** — your wallet address
- **Metadata URI** — the manifest URL
- **Manifest Hash** — the onchain hash (cross-checked against the live manifest)
- **Access Predicate** — should show the predicate address (e.g., `0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88` for ERC721OwnerPredicate)

### Client-side access preview

Use `checkToolAccess` to preview whether a wallet has access without invoking the tool. This makes the same `tryHasAccess` staticcall as `predicateGate`, but without requiring SIWE — useful for graying out "Use Tool" affordances in UIs:

```typescript
import { checkToolAccess } from "@opensea/tool-sdk"

const { ok, granted } = await checkToolAccess({
  toolId: 42n,
  account: "0xUserWalletAddress",
  // rpcUrl and chain are optional
})

if (ok && granted) {
  // enable "Use Tool" affordance
}
```

`ok === false` means the predicate misbehaved upstream — treat it as a transient failure, not a denial.

## Step 4: Client-side authentication

Callers authenticate by constructing a SIWE message, signing it, and including it in the `Authorization` header.

### Header format

```
Authorization: SIWE <base64url(siwe-message)>.<hex-signature>
```

The token is two parts separated by the last `.`:

- **`<base64url(siwe-message)>`** — the full SIWE message text, base64url-encoded
- **`<hex-signature>`** — the `0x`-prefixed hex signature from `personal_sign`

### SIWE message format

The SIWE message follows [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361):

```
my-tool.vercel.app wants you to sign in with your Ethereum account:
0xYourWalletAddress

Sign in to access my-gated-tool

URI: https://my-tool.vercel.app
Version: 1
Chain ID: 8453
Nonce: <random-nonce>
Issued At: 2025-01-01T00:00:00.000Z
Expiration Time: 2025-01-01T00:05:00.000Z
```

Key constraints enforced by the middleware:

- **`domain`** must match the endpoint's hostname (extracted from the request URL)
- **`expirationTime`** must be in the future (use short-lived values, e.g. 5 minutes)
- **`notBefore`** (if present) must be in the past

> **Warning:** `expirationTime` is optional in the SIWE spec, but omitting it with this stateless (no nonce tracking) middleware means the signed message never expires and can be replayed indefinitely. Always set a short-lived `expirationTime` (e.g., 5 minutes). Tool operators requiring stronger replay protection should implement server-side nonce tracking.

### Example client code (viem)

```typescript
import { createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"
import { createSiweMessage } from "viem/siwe"

const account = privateKeyToAccount("0xYourPrivateKey")
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(),
})

const toolUrl = "https://my-tool.vercel.app/api"
const domain = new URL(toolUrl).host

const message = createSiweMessage({
  address: account.address,
  chainId: 8453,
  domain,
  nonce: crypto.randomUUID(),
  uri: toolUrl,
  version: "1",
  expirationTime: new Date(Date.now() + 5 * 60 * 1000), // 5 min
})

const signature = await walletClient.signMessage({ message })

const token = `${Buffer.from(message).toString("base64url")}.${signature}`

const response = await fetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `SIWE ${token}`,
  },
  body: JSON.stringify({ query: "hello" }),
})
```

## Step 5: Test end-to-end

Run your tool locally and send a request with a valid SIWE header to verify the full flow. Use the client code from Step 4 against your local or deployed endpoint.

For a quick smoke test of the gate rejecting unauthenticated requests, `curl` the endpoint without the `Authorization` header:

```bash
curl -X POST https://my-tool.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

Expected response:

```json
{
  "error": "Predicate gate: SIWE authorization required",
  "hint": "Include Authorization: SIWE <base64url(message)>.<signature>"
}
```

## Delegated agent access (delegate.xyz)

An AI agent can call a predicate-gated tool **on behalf of** an NFT holder without the holder sharing their private key. The holder sets up a delegation at [delegate.xyz](https://delegate.xyz), and the agent presents the holder's address alongside its own SIWE authentication.

### How it works

1. **Holder** visits [delegate.xyz](https://delegate.xyz), connects their wallet, and delegates to the agent's address ("Delegate All" for full access)
2. **Agent** authenticates with standard SIWE (proving it controls the agent wallet) and includes an `X-Delegate-For` header with the holder's address
3. **Server** verifies the agent's SIWE, then calls `checkDelegateForAll(agent, holder)` on the [DelegateRegistry V2](https://docs.delegate.xyz) contract to confirm the delegation exists onchain
4. If valid, the access predicate runs against the **holder** (not the agent)

### Agent-side code

The simplest approach is `authenticatedFetch` with an extra `X-Delegate-For` header:

```typescript
import { authenticatedFetch } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const agentAccount = privateKeyToAccount("0xAgentPrivateKey")

const response = await authenticatedFetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Delegate-For": holderAddress, // the wallet that delegated to this agent
  },
  account: agentAccount,
  body: JSON.stringify({ query: "hello" }),
})
```

For external signers (Bankr, MPC, HSM) that sign via an API, build the header manually:

```typescript
import { createSiweMessage, createSiweAuthHeader } from "@opensea/tool-sdk"

const message = createSiweMessage({
  account: agentAccount,
  domain: new URL(toolUrl).host,
  uri: toolUrl,
})
const signature = await agentAccount.signMessage({ message })

const response = await fetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: createSiweAuthHeader(message, signature),
    "X-Delegate-For": holderAddress,
  },
  body: JSON.stringify({ query: "hello" }),
})
```

### Server-side behavior

No server code changes are needed — `predicateGate` handles the `X-Delegate-For` header automatically. When delegation is verified:

- `ctx.callerAddress` is set to the **holder's** address (the predicate subject)
- `ctx.agentAddress` is set to the **agent's** address (the SIWE signer)
- `ctx.gates.predicate.granted` is `true`

### Status codes

| Outcome | Status | Body |
|---------|--------|------|
| Invalid `X-Delegate-For` format | `400` | `{ error }` |
| Delegation not found onchain | `403` | `{ error, hint }` |
| Delegate registry call failed | `502` | `{ error }` |
| Holder fails access predicate | `403` | `{ error, toolId, predicate }` |

### Configuration

The delegate.xyz DelegateRegistry V2 is deployed at `0x00000000000000447e69651d841bD8D104Bed493` on 30+ EVM chains (including Base, Ethereum, Arbitrum, Optimism, Polygon). The middleware uses this address by default.

For local development against a forked Anvil node, override the address:

```typescript
const gate = predicateGate({
  toolId: 42n,
  delegateRegistryAddress: "0xYourLocalForkAddress",
})
```

### Revoking a delegation

The holder can revoke the delegation at any time by visiting [delegate.xyz](https://delegate.xyz) and removing the agent. The revocation is immediate — the next request from the agent will receive a 403.

## Combining predicate gating with x402 payment

You can stack both gates to require **identity verification and per-call payment**:

```typescript
import {
  createToolHandler,
  defineManifest,
  payaiX402Gate,
  predicateGate,
  x402UsdcPricing,
} from "@opensea/tool-sdk"

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
  gates: [
    predicateGate({ toolId: 1n }),
    payaiX402Gate({
      recipient: "0xYourPayoutAddress",
      amountUsdc: "0.01",
    }),
  ],
  handler: async (input, ctx) => {
    // ctx.callerAddress — verified wallet (set by predicate gate)
    // ctx.gates.predicate.granted === true
    // ctx.gates.x402.paid === true
    return { result: "access granted and payment received" }
  },
})
```

### Middleware ordering

Gates run in array order (see `src/lib/handler/index.ts`). Put `predicateGate` **first**:

1. **Predicate gate** runs first — verifies the SIWE signature and establishes `ctx.callerAddress`. Returns `401` if the signature is invalid or `403` if the predicate denies access.
2. **x402 gate** runs second — checks the `X-Payment` header and verifies the payment. Returns `402` if no payment is provided.

This ordering ensures identity is established before payment is processed.

### Client requirements

Callers must include **both** headers:

```
Authorization: SIWE <base64url(message)>.<signature>
X-Payment: <base64-encoded-payment-payload>
```

Use the SIWE client code from [Step 4](#step-4-client-side-authentication) for the `Authorization` header and `signX402Payment` or `paidFetch` from `@opensea/tool-sdk` for the `X-Payment` header. When using `paidFetch`, add the `Authorization` header manually in the `headers` option.
