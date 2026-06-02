# Predicate-Gated Tools Guide

Gate your tool using the onchain access predicate system. Callers prove their identity by signing an EIP-3009 zero-value `TransferWithAuthorization` ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)), and the SDK delegates the access decision to the `ToolRegistry` contract — whatever predicate the tool's creator registered is the policy enforced.

## Overview

The tool-sdk supports two independent gating mechanisms:

| Gate | Purpose | How it works |
|------|---------|--------------|
| **Predicate gate** | Identity-based access control | Caller signs an EIP-3009 zero-value authorization; the middleware recovers the address via `ecrecover` and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)` to check the registered predicate. Supports [delegated agent access](#delegated-agent-access-delegatexyz) via `X-Delegate-For` header. |
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

Tool creators configure the predicate onchain (via `register --access-predicate` or direct contract calls). The `predicateGate` middleware picks it up at runtime — no code changes needed when the access policy changes.

The canonical `ERC721OwnerPredicate` (v0.2) is deployed on Ethereum mainnet, Base, Shape, and Abstract at `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` (see `src/lib/onchain/chains.ts`).

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
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
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

1. Extracts the `Authorization: EIP-3009 <token>` header (also accepts deprecated `Authorization: SIWE <token>` for backward compatibility)
2. Decodes and parses the EIP-3009 authorization JSON (base64url-encoded)
3. Validates required fields (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`, `signature`)
4. Checks `validBefore` (must be in the future) and `validAfter` (must be in the past)
5. Recovers the signer via `ecrecover` on the EIP-712 typed data — no RPC call needed
6. Calls `registry.tryHasAccess(toolId, recoveredAddress, data)` — a staticcall to the onchain `ToolRegistry`
7. If `(ok=true, granted=true)`, sets `ctx.callerAddress` and `ctx.gates.predicate.granted = true`

Status code mapping:

| Outcome | Status | Body |
|---------|--------|------|
| Missing or malformed authorization | `401` | `{ error, hint }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "predicate misbehaved..." }` |

The `predicate` field in the 403 body is the registered access predicate's address, so callers can self-diagnose what they need to satisfy.

The gate enforces a short-lived `validBefore` window (the SDK defaults to 5 minutes). Each EIP-3009 authorization includes a random `nonce` bound into the signature — the gate does not track nonces server-side, so callers should keep `validBefore` short to limit the replay window.

## Step 2: Register with `--access-predicate`

Register your tool onchain with the `--access-predicate` flag, passing your predicate contract address:

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --access-predicate 0xYourPredicateAddress
```

This calls **`registerTool`** on the `ToolRegistry` contract and sets `accessPredicate` to the provided address.

Use `--dry-run` to preview the registration without sending transactions:

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --access-predicate 0xYourPredicateAddress \
  --dry-run
```

For ERC-721 gating, use the canonical v0.2 `ERC721OwnerPredicate` at `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` (Ethereum mainnet, Base, Shape, Abstract). After registration, call `setCollections(toolId, [collectionAddress])` on the predicate to configure which collections gate the tool.

## Step 3: Verify the setup

After registration, use `inspect` to confirm the onchain state:

```bash
npx @opensea/tool-sdk inspect --tool-id <id> --network base
```

This reads the tool config from the `ToolRegistry` and displays:

- **Creator** — your wallet address
- **Metadata URI** — the manifest URL
- **Manifest Hash** — the onchain hash (cross-checked against the live manifest)
- **Access Predicate** — should show the predicate address (e.g., `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` for the v0.2 ERC721OwnerPredicate)

### Client-side access preview

Use `checkToolAccess` to preview whether a wallet has access without invoking the tool. This makes the same `tryHasAccess` staticcall as `predicateGate`, but without requiring authentication — useful for graying out "Use Tool" affordances in UIs:

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

Callers authenticate by signing an EIP-3009 zero-value `TransferWithAuthorization` and including it in the `Authorization` header.

### Header format

```
Authorization: EIP-3009 <base64url(json)>
```

The token is a base64url-encoded JSON object containing the EIP-3009 authorization fields:

```json
{
  "from": "0xCallerAddress",
  "to": "0xOperatorOrZeroAddress",
  "value": "0",
  "validAfter": "0",
  "validBefore": "1735689900",
  "nonce": "0xrandom32bytes",
  "signature": "0x..."
}
```

Key constraints enforced by the middleware:

- **`validBefore`** must be in the future (the SDK defaults to `now + 5 minutes`)
- **`validAfter`** must be in the past (typically `0`)
- **`value`** must be `"0"` (zero-value transfer — used for identity proof, not payment)
- **`from`** is recovered via `ecrecover` and used as the caller address

> **Tip:** The `to` field can be the tool operator's address for domain binding, or `0x0` as a fallback. The SDK's `eip3009AuthenticatedFetch` accepts an optional `to` parameter.

### Example client code (SDK)

The simplest approach is `eip3009AuthenticatedFetch`:

```typescript
import { eip3009AuthenticatedFetch } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount("0xYourPrivateKey")
const toolUrl = "https://my-tool.vercel.app/api"

const response = await eip3009AuthenticatedFetch(toolUrl, {
  account,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  // to: "0xOperatorAddress",  // optional domain binding
  // chainId: 8453,             // default: Base
})
```

For external signers (Bankr, MPC, HSM) that sign via an API, build the header manually:

```typescript
import { createEip3009AuthHeader, signZeroValueAuthorization } from "@opensea/tool-sdk"
import { createWalletClient, http } from "viem"
import { base } from "viem/chains"

const walletClient = createWalletClient({ account, chain: base, transport: http() })

const authorization = await signZeroValueAuthorization({
  walletClient,
  from: account.address,
  to: "0x0000000000000000000000000000000000000000",
  chainId: 8453,
})

const response = await fetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: createEip3009AuthHeader(authorization),
  },
  body: JSON.stringify({ query: "hello" }),
})
```

## Step 5: Test end-to-end

Run your tool locally and send a request with a valid EIP-3009 authorization header to verify the full flow. Use the client code from Step 4 against your local or deployed endpoint.

For a quick smoke test of the gate rejecting unauthenticated requests, `curl` the endpoint without the `Authorization` header:

```bash
curl -X POST https://my-tool.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

Expected response:

```json
{
  "error": "Predicate gate: EIP-3009 authorization required",
  "hint": "Include Authorization: EIP-3009 <base64url(json)>"
}
```

## Delegated agent access (delegate.xyz)

An AI agent can call a predicate-gated tool **on behalf of** an NFT holder without the holder sharing their private key. The holder sets up a delegation at [delegate.xyz](https://delegate.xyz), and the agent presents the holder's address alongside its own EIP-3009 authentication.

### How it works

1. **Holder** visits [delegate.xyz](https://delegate.xyz), connects their wallet, and delegates to the agent's address ("Delegate All" for full access)
2. **Agent** authenticates with EIP-3009 (proving it controls the agent wallet) and includes an `X-Delegate-For` header with the holder's address
3. **Server** verifies the agent's EIP-3009 signature via `ecrecover`, then calls `checkDelegateForAll(agent, holder)` on the [DelegateRegistry V2](https://docs.delegate.xyz) contract to confirm the delegation exists onchain
4. If valid, the access predicate runs against the **holder** (not the agent)

### Agent-side code

The simplest approach is `eip3009AuthenticatedFetch` with an extra `X-Delegate-For` header:

```typescript
import { eip3009AuthenticatedFetch } from "@opensea/tool-sdk"
import { privateKeyToAccount } from "viem/accounts"

const agentAccount = privateKeyToAccount("0xAgentPrivateKey")

const response = await eip3009AuthenticatedFetch(toolUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Delegate-For": holderAddress, // the wallet that delegated to this agent
  },
  account: agentAccount,
  body: JSON.stringify({ query: "hello" }),
})
```

### Server-side behavior

No server code changes are needed — `predicateGate` handles the `X-Delegate-For` header automatically. When delegation is verified via `ecrecover` + `checkDelegateForAll`:

- `ctx.callerAddress` is set to the **holder's** address (the predicate subject)
- `ctx.agentAddress` is set to the **agent's** address (the EIP-3009 signer)
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

1. **Predicate gate** runs first — verifies the EIP-3009 signature and establishes `ctx.callerAddress`. Returns `401` if the signature is invalid or `403` if the predicate denies access.
2. **x402 gate** runs second — checks the `X-Payment` header and verifies the payment. Returns `402` if no payment is provided.

This ordering ensures identity is established before payment is processed.

### Client requirements

Callers must include **both** headers:

```
Authorization: EIP-3009 <base64url(json)>
X-Payment: <base64-encoded-payment-payload>
```

The easiest way is `paidAuthenticatedFetch`, which handles both headers automatically:

```typescript
import { paidAuthenticatedFetch } from "@opensea/tool-sdk"

const response = await paidAuthenticatedFetch(toolUrl, {
  account,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
})
```

Alternatively, use the EIP-3009 client code from [Step 4](#step-4-client-side-authentication) for the `Authorization` header and `signX402Payment` or `paidFetch` from `@opensea/tool-sdk` for the `X-Payment` header.
