# Predicate-Gated Tools Guide

Gate your tool using the onchain access predicate system. When `operatorAddress` is configured, the gate uses a unified 402 challenge flow: it returns `PaymentRequirements` with `maxAmountRequired: "0"`, and the caller signs a zero-value `X-Payment` header (an EIP-3009 `TransferWithAuthorization` with `value=0`). The SDK recovers the caller's address and delegates the access decision to the `ToolRegistry` contract — whatever predicate the tool's creator registered is the policy enforced.

## Overview

The tool-sdk supports two independent gating mechanisms:

| Gate | Purpose | How it works |
|------|---------|--------------|
| **Predicate gate** | Identity-based access control | With `operatorAddress` configured, the gate returns 402 with `PaymentRequirements` (`maxAmountRequired: "0"`). The caller signs a zero-value `X-Payment` and retries. The middleware recovers the address via `ecrecover` and staticcalls `IToolRegistry.tryHasAccess(toolId, caller, data)` to check the registered predicate. Supports [delegated agent access](#delegated-agent-access-delegatexyz) via `X-Delegate-For` header. |
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

1. Checks for an `X-Payment` header (preferred) or `Authorization: EIP-3009 <token>` header (also accepts deprecated `Authorization: SIWE <token>` for backward compatibility)
2. If no auth is present and `operatorAddress` is configured, returns 402 with `PaymentRequirements` (`payTo`=operator, `maxAmountRequired`=`"0"`, `scheme`=`"exact"`)
3. Decodes and validates the authorization (from `X-Payment` or `Authorization` header)
4. Checks `validBefore` (must be in the future) and `validAfter` (must be in the past)
5. Recovers the signer via `ecrecover` on the EIP-712 typed data — no RPC call needed
6. Calls `registry.tryHasAccess(toolId, recoveredAddress, data)` — a staticcall to the onchain `ToolRegistry`
7. If `(ok=true, granted=true)`, sets `ctx.callerAddress` and `ctx.gates.predicate.granted = true`

Status code mapping:

| Outcome | Status | Body |
|---------|--------|------|
| No auth, `operatorAddress` configured | `402` | `{ accepts: [{ payTo, maxAmountRequired: "0", scheme: "exact", ... }] }` |
| No auth, no `operatorAddress` | `401` | `{ error, hint }` |
| Malformed `X-Payment` or `Authorization` | `401` | `{ error }` |
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

When `operatorAddress` is configured, the gate returns a 402 challenge. The client handles this automatically via `eip3009AuthenticatedFetch`: it sends a bare request, reads the `PaymentRequirements` from the 402, signs a zero-value `X-Payment`, and retries.

### Preferred flow (402 + X-Payment)

The `X-Payment` header carries a base64-encoded JSON payload containing an EIP-3009 `TransferWithAuthorization` (value=0) signed against the operator address from the 402 challenge.

Key constraints enforced by the middleware:

- **`validBefore`** must be in the future (the SDK defaults to `now + 5 minutes`)
- **`validAfter`** must be in the past (typically `0`)
- **`value`** must be `"0"` (zero-value transfer — used for identity proof, not payment)
- **`from`** is recovered via `ecrecover` and used as the caller address
- **`to`** must match the gate's `operatorAddress` (the 402 challenge advertises this as `payTo`)

### Example client code (SDK)

The simplest approach is `eip3009AuthenticatedFetch`, which handles the 402 challenge automatically:

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
  allowedRecipients: ["0xOperatorAddress"],  // optional: restrict payTo addresses
})
```

> **Backward compatibility:** The gate still accepts `Authorization: EIP-3009 <base64url(json)>` headers directly. For external signers (Bankr, MPC, HSM) that build headers manually, `createEip3009AuthHeader` and `signZeroValueAuthorization` remain available.

```typescript
import { createEip3009AuthHeader, signZeroValueAuthorization } from "@opensea/tool-sdk"
import { createWalletClient, http } from "viem"
import { base } from "viem/chains"

const walletClient = createWalletClient({ account, chain: base, transport: http() })

const authorization = await signZeroValueAuthorization({
  walletClient,
  from: account.address,
  to: "0xOperatorAddress",
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

For a quick smoke test of the gate rejecting unauthenticated requests, `curl` the endpoint without any auth headers:

```bash
curl -X POST https://my-tool.vercel.app/api \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

Expected response (when `operatorAddress` is configured):

```json
{
  "x402Version": 1,
  "error": "Predicate gate: X-PAYMENT header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "0",
    "payTo": "0xOperatorAddress",
    "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  }]
}
```

HTTP status: `402`. If `operatorAddress` is not configured, the gate returns `401` with `{ error, hint }` (legacy behavior).
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

Use `paidPredicateGate` to require **identity verification and per-call payment** in a single 402 round trip (2 requests total instead of 3):

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
    // ctx.callerAddress — verified wallet (recovered from X-Payment)
    // ctx.gates.predicate.granted === true
    // ctx.gates.x402.paid === true
    return { result: "access granted and payment received" }
  },
})
```

### How `paidPredicateGate` works

The combined gate issues a single 402 with the **real payment amount** (not zero). The caller's `X-Payment` signature simultaneously:
- Proves identity (the recovered `from` address)
- Authorizes the USDC transfer (via the facilitator)

The gate runs these checks in order:
1. Verify the EIP-712 signature and recover the caller's address
2. Check the onchain predicate (`tryHasAccess`) — returns 403 if denied
3. Verify the payment with the facilitator — returns 402 if invalid
4. After the handler succeeds: settle the payment via the facilitator

This ordering ensures **no funds move** if the predicate denies access.

### Client requirements

`paidAuthenticatedFetch` handles the 402 challenge automatically. Since `paidPredicateGate` issues only one 402, the client signs once and the call completes:

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

For backward compatibility, you can still chain `predicateGate` + x402 gate as separate middleware. The client handles both 402s in a retry loop. However, `paidPredicateGate` is preferred for new tools.

```typescript
gates: [
  predicateGate({ toolId: 1n, operatorAddress: "0x..." }),
  payaiX402Gate({ recipient: "0x...", amountUsdc: "0.01" }),
]
```
