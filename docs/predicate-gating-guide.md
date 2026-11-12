# Predicate-gated tools guide

A predicate gate restricts a tool to callers who pass an onchain access predicate. It uses the same 402 challenge as paid tools: the gate returns `PaymentRequirements` with `maxAmountRequired: "0"`, and the caller signs a zero-value `X-Payment` header (an EIP-3009 `TransferWithAuthorization` with `value=0`). The signed recipient is derived from the endpoint URL, tool ID, and operator. The SDK checks that audience binding, recovers the caller's address, and asks the `ToolRegistry` contract for the access decision.

## Overview

The SDK has two independent kinds of gate:

| Gate | Purpose | How it works |
|------|---------|--------------|
| **Predicate gate** | Identity-based access control | The gate returns 402 with `PaymentRequirements` (`maxAmountRequired: "0"`). The caller verifies the endpoint binding, signs a zero-value `X-Payment`, and retries. The middleware recovers the address via `ecrecover` and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)` to check the registered predicate. Supports [delegated agent access](#delegated-agent-access-delegatexyz) through the `X-Delegate-For` header. |
| **x402 gate** | Payment-based access control | The caller sends an `X-Payment` header with a signed USDC transfer authorization, and a facilitator verifies and settles the payment |

Use a predicate gate when access depends on **who the caller is**, and x402 when it depends on **paying per call**. You can [combine both](#combining-predicate-gating-with-x402-payment).

### Architecture

`predicateGate` works with any predicate registered against the `ToolRegistry`:

| Predicate | Use case |
|-----------|----------|
| `ERC721OwnerPredicate` | Gate to holders of one or more ERC-721 collections |
| `ERC1155OwnerPredicate` | Gate to holders of ERC-1155 tokens |
| `SubscriptionPredicate` | Gate to active subscribers (ERC-5643) |
| `CompositePredicate` | Combine multiple predicates with AND/OR logic |
| Future predicates | Any contract implementing `IAccessPredicate` works without SDK changes |

Tool creators set the predicate onchain, with `register --access-predicate` or a direct contract call. `predicateGate` reads it at runtime, so changing the access policy needs no code change.

The canonical `ERC721OwnerPredicate` (v0.2) is deployed on Ethereum mainnet, Base, Shape, Abstract, Monad, and Robinhood Chain at `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` (see `src/lib/onchain/chains.ts`).

## Prerequisites

- An access predicate configured onchain for your tool (for example, an ERC-721 collection on Base)
- The tool deployed and serving its manifest at `/.well-known/ai-tool/<slug>.json`

## Step 1: Configure the gate in your handler

Add `predicateGate({ toolId, operatorAddress })` to the `gates` array in `createToolHandler`. `toolId` is the numeric ID from the `ToolRegistered` event emitted when you registered the tool.

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
      operatorAddress: "0xYourOperatorAddress",
      // rpcUrl is optional; defaults to the chain's public RPC (https://mainnet.base.org on Base)
      // audience is optional unless a proxy rewrites the public request URL
      // audience: "https://my-tool.vercel.app/api",
    }),
  ],
  handler: async (input, ctx) => {
    // ctx.callerAddress is the verified wallet address
    // ctx.gates.predicate.granted === true
    return { result: `Hello: ${ctx.callerAddress}` }
  },
})
```

On each request, the middleware (`src/lib/middleware/predicate-gate.ts`):

1. Looks for an `X-Payment` header. It reads no other auth header.
2. If the header is missing, returns 402 with a `payTo` derived from the endpoint URL, tool ID, and operator. The client verifies that binding before it signs.
3. Decodes and validates the authorization in `X-Payment`.
4. Checks that `validBefore` is in the future and at most 1 hour ahead, and that `validAfter` is in the past.
5. Recovers the signer with `ecrecover` on the EIP-712 typed data. No RPC call is needed.
6. Calls `registry.tryHasAccess(toolId, recoveredAddress, data)`, a staticcall to the onchain `ToolRegistry`.
7. On `(ok=true, granted=true)`, reserves the authorization through `replayGuard` if one is configured, then sets `ctx.callerAddress` and `ctx.gates.predicate.granted = true`.

Status code mapping:

| Outcome | Status | Body |
|---------|--------|------|
| No `X-Payment` header | `402` | `{ accepts: [{ payTo, maxAmountRequired: "0", scheme: "exact", ... }] }` |
| Malformed, expired, or mis-bound `X-Payment` | `401` | `{ error }` |
| Unsupported `x402Version` in `X-Payment` | `400` | `{ error }` |
| `tryHasAccess` returned `(true, true)` | (passes) | n/a |
| `tryHasAccess` returned `(true, false)` | `403` | `{ error, toolId, predicate }` |
| `tryHasAccess` returned `(false, *)` | `502` | `{ error: "predicate misbehaved..." }` |

The `predicate` field in the 403 body is the registered access predicate's address, so callers can see what they need to satisfy.

The 1-hour cap on `validBefore` is enforced server-side, and SDK clients sign a shorter window. The audience binding stops replay against other endpoints. To stop the same authorization from running the intended endpoint twice, configure `replayGuard` with an atomic shared store. See [Replay protection](../README.md#replay-protection) in the tool-sdk README.

## Step 2: Register with `--access-predicate`

Register the tool onchain and pass the predicate contract address with `--access-predicate`:

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --access-predicate 0xYourPredicateAddress
```

This calls `registerTool` on the `ToolRegistry` contract with `accessPredicate` set to that address.

Add `--dry-run` to preview the registration without sending a transaction:

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org npx @opensea/tool-sdk register \
  --metadata https://my-tool.vercel.app/.well-known/ai-tool/my-tool.json \
  --network base \
  --access-predicate 0xYourPredicateAddress \
  --dry-run
```

For ERC-721 gating, use the canonical v0.2 `ERC721OwnerPredicate` at `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` (Ethereum mainnet, Base, Shape, Abstract, Monad, Robinhood Chain). After registering, call `setCollections(toolId, [collectionAddress])` on the predicate to choose which collections gate the tool.

## Step 3: Verify the setup

Confirm the onchain state with `inspect`:

```bash
npx @opensea/tool-sdk inspect --tool-id <id> --network base
```

It reads the tool config from the `ToolRegistry` and prints:

- Creator: your wallet address
- Metadata URI: the manifest URL
- Manifest Hash: the onchain hash, cross-checked against the live manifest
- Access Predicate: the predicate address (for example `0xc8721c9A776958FfFfEb602DA1b708bf1D318379` for the v0.2 ERC721OwnerPredicate)

### Client-side access preview

`checkToolAccess` tells you whether a wallet has access without calling the tool. It makes the same `tryHasAccess` staticcall as `predicateGate` but needs no authentication, which makes it useful for disabling a "Use Tool" button in a UI:

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

`ok === false` means the predicate misbehaved upstream. Treat it as a transient failure, not a denial.

## Step 4: Client-side authentication

`eip3009AuthenticatedFetch` answers the gate's 402 challenge for you. It sends a bare request, reads the `PaymentRequirements`, verifies that `payTo` is bound to the final endpoint URL, tool ID, and operator, signs a zero-value `X-Payment`, and retries.

### Preferred flow (402 + X-Payment)

The `X-Payment` header is base64-encoded JSON holding an EIP-3009 `TransferWithAuthorization` (value=0), signed for the derived audience recipient from the 402 challenge.

The middleware enforces:

- `validBefore` must be in the future and at most 1 hour ahead. `eip3009AuthenticatedFetch` signs `now + 10 minutes`.
- `validAfter` must be in the past (usually `0`).
- `value` must be exactly the string `"0"`. The transfer proves identity and moves no funds. The free `predicateGate` rejects anything else, so third-party clients must send `"0"`, not `"0x0"` or `"00"`.
- `from` is recovered with `ecrecover` and becomes the caller address.
- `to` must match the address derived from the endpoint URL, tool ID, and operator (the challenge's `payTo`).
- The chainId resolved from the authorization's `network` must match the gate's identity chain: the registry chain when it is Base or Base Sepolia, otherwise Base.

### Example client code (SDK)

`eip3009AuthenticatedFetch` handles the 402 challenge:

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
})
```

`eip3009AuthenticatedFetch` rejects zero-value challenges from older servers that omit the audience-binding metadata, so update client and server together.

## Step 5: Test end-to-end

Point the client code from Step 4 at your local or deployed endpoint to exercise the full flow.

To check that the gate rejects unauthenticated requests, `curl` the endpoint with no `X-Payment` header:

```bash
curl -X POST https://my-tool.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

Expected response:

```json
{
  "x402Version": 1,
  "error": "Predicate gate: X-PAYMENT header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "0",
    "payTo": "0xDerivedAudienceRecipient",
    "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "extra": {
      "name": "USD Coin",
      "version": "2",
      "predicateGate": {
        "toolId": "42",
        "operatorAddress": "0xYourOperatorAddress"
      }
    }
  }]
}
```

HTTP status: `402`.

## Delegated agent access (delegate.xyz)

An AI agent can call a predicate-gated tool **on behalf of** an NFT holder without the holder's private key. The holder creates a delegation at [delegate.xyz](https://delegate.xyz), and the agent sends the holder's address along with its own EIP-3009 authorization.

### How it works

1. The holder connects a wallet at [delegate.xyz](https://delegate.xyz) and delegates to the agent's address ("Delegate All" for full access).
2. The agent signs an EIP-3009 authorization, proving it controls the agent wallet, and adds an `X-Delegate-For` header with the holder's address.
3. The server verifies the agent's signature with `ecrecover`, then calls `checkDelegateForAll(agent, holder)` on the [DelegateRegistry V2](https://docs.delegate.xyz) contract to confirm the delegation exists onchain.
4. If it does, the access predicate runs against the **holder**, not the agent.

### Agent-side code

Use `eip3009AuthenticatedFetch` with an extra `X-Delegate-For` header:

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

The server needs no code changes: `predicateGate` handles `X-Delegate-For` itself. Once `ecrecover` and `checkDelegateForAll` confirm the delegation:

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

The middleware defaults to the delegate.xyz DelegateRegistry V2 at `0x00000000000000447e69651d841bD8D104Bed493`, deployed on 30+ EVM chains including Base, Ethereum, Arbitrum, Optimism, and Polygon.

For local development against a forked Anvil node, override the address:

```typescript
const gate = predicateGate({
  toolId: 42n,
  operatorAddress: "0xYourOperatorAddress",
  delegateRegistryAddress: "0xYourLocalForkAddress",
})
```

### Revoking a delegation

The holder can remove the agent at [delegate.xyz](https://delegate.xyz) at any time. Revocation takes effect immediately, and the agent's next request gets a 403.

## Combining predicate gating with x402 payment

`paidPredicateGate` requires **identity and per-call payment** in one 402 round trip, two requests instead of three:

```typescript
import {
  createToolHandler,
  defineManifest,
  paidPredicateGate,
} from "@opensea/tool-sdk"
import { mainnet } from "viem/chains"

export const manifest = defineManifest({
  // ...
  pricing: { model: "pay_per_call", amount: "0.01", currency: "USDC" },
})

const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [
    paidPredicateGate({
      toolId: 1n,
      operatorAddress: "0xYourPayoutAddress",
      amountUsdc: "0.01",
      chain: mainnet,
      rpcUrl: "https://ethereum-rpc.publicnode.com",
    }),
  ],
  handler: async (input, ctx) => {
    // ctx.callerAddress: verified wallet (recovered from X-Payment)
    // ctx.gates.predicate.granted === true
    // ctx.gates.x402.paid === true
    return { result: "access granted and payment received" }
  },
})
```

### How `paidPredicateGate` works

The combined gate issues one 402 with the **real payment amount**, not zero. The caller's single `X-Payment` signature both proves identity (the recovered `from` address) and authorizes the USDC transfer through the facilitator.

The gate runs these checks in order:

1. Verify the EIP-712 signature and recover the caller's address.
2. Check the onchain predicate (`tryHasAccess`). Returns 403 if denied.
3. Verify the payment with the facilitator. Returns 402 if invalid.
4. After the handler succeeds, settle the payment through the facilitator.

Because the predicate runs first, **no funds move** when access is denied.

### Client requirements

`paidAuthenticatedFetch` handles the 402 challenge. `paidPredicateGate` issues only one 402, so the client signs once:

```typescript
import { paidAuthenticatedFetch } from "@opensea/tool-sdk"

const response = await paidAuthenticatedFetch(toolUrl, {
  account,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  maxAmount: "100000",  // safety cap: 0.10 USDC
  allowedRecipients: ["0xYourPayoutAddress"],
})
```

### Legacy: separate gates (3 requests)

You can still chain `predicateGate` and an x402 gate as separate middleware, and `paidAuthenticatedFetch` answers both 402s in a retry loop. New tools should use `paidPredicateGate`.

```typescript
gates: [
  predicateGate({ toolId: 1n, operatorAddress: "0x..." }),
  payaiX402Gate({ recipient: "0x...", amountUsdc: "0.01" }),
]
```
