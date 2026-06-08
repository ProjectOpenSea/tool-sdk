# Predicate-Gated Tools (402 Challenge + 403 Access Control)

Predicate gating restricts tool access based on onchain state (NFT ownership, subscriptions, composite logic). When `operatorAddress` is configured, the gate uses the same 402 challenge flow as x402: the server returns `HTTP 402` with `PaymentRequirements` (`maxAmountRequired: "0"`), and the caller replays with a zero-value `X-Payment` header. The server recovers the caller's address from the `X-Payment` signature and checks the configured `IAccessPredicate` contract via the ToolRegistry.

## How predicate gating works

```
Agent                        Tool Server                   ToolRegistry (onchain)
  |--- POST /api ------------->|                                |
  |    (no auth headers)       |                                |
  |                            |  (no X-Payment → 402)          |
  |<-- 402 + PaymentReqs ------|                                |
  |    {payTo: operator,       |                                |
  |     maxAmountRequired: "0"}|                                |
  |                            |                                |
  |  (sign X-Payment with      |                                |
  |   to=operator, value=0)    |                                |
  |                            |                                |
  |--- POST /api ------------->|                                |
  |    X-Payment: <base64>     |                                |
  |                            |  (verify X-Payment signature)  |
  |                            |  (recover signer = from)       |
  |                            |--- staticcall tryHasAccess --->|
  |                            |    (toolId, callerAddr, data)  |
  |                            |<-- (ok=true, granted=true) ----|
  |                            |                                |
  |                            |  (execute tool handler)        |
  |<-- 200 + result -----------|                                |
```

1. Agent sends a bare request (no auth headers)
2. Server returns `402` with `PaymentRequirements` (`payTo`=operator, `maxAmountRequired`=`"0"`, `scheme`=`"exact"`)
3. Agent signs a zero-value `X-Payment` (EIP-3009 `TransferWithAuthorization` with `to`=operator, `value`=0)
4. Agent retries the request with the `X-Payment` header
5. Server recovers the caller's address via `ecrecover` on the EIP-712 typed data (no RPC call needed)
6. Server calls `ToolRegistry.tryHasAccess(toolId, callerAddress, data)` which delegates to the tool's configured `IAccessPredicate`
7. If access is granted: execute handler, return 200
8. If access is denied: return 403 with predicate address for self-diagnosis
9. If predicate misbehaved: return 502

> **Backward compatibility:** The gate still accepts `Authorization: EIP-3009 <base64url(json)>` and deprecated `Authorization: SIWE <token>` headers. However, the 402 + `X-Payment` flow is preferred for new integrations because it mirrors the x402 pattern and lets the client discover the correct `to` address from the challenge.

## Build a predicate-gated tool (server side)

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
  // what they need before calling (see known-predicates.md).
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
    // ctx.callerAddress is set after a successful predicate check
    return { result: `Hello ${ctx.callerAddress}, result: ${input.query}` }
  },
})
```

## Call a predicate-gated tool (agent/client side)

### Via CLI

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk auth \
  https://my-tool.example.com/api \
  --body '{"query": "hello"}'
```

### Via SDK: `eip3009AuthenticatedFetch`

`eip3009AuthenticatedFetch` handles the 402 challenge automatically: it sends a bare request, reads the `PaymentRequirements` from the 402 response, signs a zero-value `X-Payment`, and retries.

```typescript
import { eip3009AuthenticatedFetch, createWalletFromEnv, walletAdapterToClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const client = await walletAdapterToClient(adapter, base)

const res = await eip3009AuthenticatedFetch("https://my-tool.example.com/api", {
  account: client.account,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  allowedRecipients: ["0xOPERATOR_ADDRESS"],  // optional: restrict which payTo addresses to sign for
})

const data = await res.json()
```

### Check access before calling (preview)

```typescript
import { checkToolAccess } from "@opensea/tool-sdk"

const { ok, granted } = await checkToolAccess({
  toolId: 1n,
  account: "0xYOUR_WALLET",
  // chain: base,
  // rpcUrl: "https://mainnet.base.org",
})

if (!ok) console.error("Predicate misbehaved")
else if (!granted) console.error("Access denied: you don't meet the requirements")
else console.log("Access granted: safe to call")
```

## Handling 403 responses

When the predicate denies access, the server returns:

```json
{
  "error": "Predicate gate: access predicate denied",
  "toolId": "1",
  "predicate": "0xc8721c9A776958FfFfEb602DA1b708bf1D318379"
}
```

The `predicate` address tells the agent which predicate contract to inspect. Agents can call `IAccessPredicate.getRequirements(toolId)` to discover what's needed:

```typescript
import { IAccessPredicateABI } from "@opensea/tool-sdk"
import { createPublicClient, http } from "viem"
import { base } from "viem/chains"

const client = createPublicClient({ chain: base, transport: http() })

const [requirements, logic] = await client.readContract({
  address: "0xc8721c9A776958FfFfEb602DA1b708bf1D318379",
  abi: IAccessPredicateABI,
  functionName: "getRequirements",
  args: [1n],  // toolId
})

// requirements: [{ kind: "0xbdf8c428", data: "0x...", label: "..." }]
// logic: 0 = AND, 1 = OR
```

## Combined gates (predicate + x402)

Tools can require both identity verification and x402 payment. The server runs gates sequentially: predicate first (identity via zero-value `X-Payment`), then x402 (real payment via `X-Payment`). The client handles multiple 402 challenges in a retry loop.

### Server side

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
    paywall.gate,                   // checked second
  ],
  handler: async (input) => ({ result: input.query }),
})
```

### Client side: `paidAuthenticatedFetch`

`paidAuthenticatedFetch` handles multiple 402 challenges automatically: it sends a bare request, then on each 402 it reads the `PaymentRequirements`, signs an `X-Payment`, and retries. For a combined predicate + x402 tool, the first 402 is the predicate's zero-value challenge and the second is the x402 real payment.

```typescript
import { paidAuthenticatedFetch, createWalletFromEnv, walletAdapterToClient } from "@opensea/tool-sdk"
import { base } from "viem/chains"

const adapter = createWalletFromEnv()
const client = await walletAdapterToClient(adapter, base)

const res = await paidAuthenticatedFetch("https://my-tool.example.com/api", {
  account: client.account,   // for X-Payment signing (identity + payment)
  signer: adapter,           // for x402 payment signing (can differ from account)
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "hello" }),
  maxAmount: "100000",       // safety cap: 0.10 USDC
})
```

### Via CLI (auto-detect both gates)

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk smoke \
  --endpoint https://my-tool.example.com/api \
  --expect 200
```
