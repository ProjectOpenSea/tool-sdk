# Token + NFT Holder Overlap Tool

> [!NOTE]
> **Reference implementation.** This is a worked example shipped
> alongside `@opensea/tool-sdk` to demonstrate building a **free,
> predicate-gated** ERC-8257 tool — no x402 paywall, just an
> `ERC721OwnerPredicate` access gate. Use the code as a starting
> point for your own tool.

An [ERC-8257](https://eips.ethereum.org/EIPS/eip-8257) agent tool that
finds wallets holding both a specified ERC-20 token and NFTs from a
given collection. Returns the overlap set ranked by token USD value,
with overlap rates in both directions.

Built with [`@opensea/tool-sdk`](https://github.com/ProjectOpenSea/tool-sdk)
and the [OpenSea v2 REST API](https://docs.opensea.io/reference/api-overview).
No LLM required — pure data aggregation.

## Live deployment

Registered on Ethereum mainnet's `ToolRegistry`
([`0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`](https://etherscan.io/address/0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1))
as **tool ID 36**, served at https://token-nft-overlap-tool.vercel.app.

| Endpoint | Price | Gating | Tool ID |
|----------|-------|--------|---------|
| `/api` | Free | EIP-3009 auth + ERC-721 ownership of [tiny dinos (eth)](https://opensea.io/assets/ethereum/0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4) on Ethereum mainnet | [36](https://etherscan.io/tx/0xda00ae5165ccef4c9ee2c3ed9e5befc3ec4f99cc36d752f118c884a6e97d0e0c) |

Manifest: https://token-nft-overlap-tool.vercel.app/.well-known/ai-tool/token-nft-overlap.json

> [!NOTE]
> This deploy is illustrative, not a production service, and may change or go
> offline without notice. Fork the code to run your own.

## Access model

| Tier | Price | Gating |
|------|-------|--------|
| Holder-only | Free | EIP-3009 auth + ERC-721 ownership of [`0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4`](https://opensea.io/assets/ethereum/0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4) on Ethereum mainnet |

Manifest: `/.well-known/ai-tool/token-nft-overlap.json`

## Calling the tool

`POST` to `/api` with a JSON body:

```json
{
  "tokenAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "collectionSlug": "boredapeyachtclub",
  "chain": "ethereum",
  "maxPages": 5
}
```

The tool is free but gated. An unauthenticated request returns an x402
`HTTP 402` with `PaymentRequirements` whose `payTo` is the tool operator
and whose `maxAmountRequired` is `"0"`. The caller replays the request
with a zero-value `X-Payment` header; the gate recovers the signer from
its `from` field and checks tiny-dinos ownership on Ethereum mainnet. A
holder receives the structured overlap report; a non-holder gets `403`.

### Calling via `tool-sdk pay`

`tool-sdk pay` performs the 402 handshake for you: it sends the request,
reads the `PaymentRequirements`, signs a zero-value `X-Payment` (the tool
is free), and replays. The signing wallet must hold a gating NFT.

```bash
PRIVATE_KEY=0x... \
  npx @opensea/tool-sdk pay https://your-deploy.example.com/api \
    --body '{"tokenAddress":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","collectionSlug":"boredapeyachtclub"}'
```

## OpenSea API endpoints used

| Endpoint | Purpose |
|----------|---------|
| `GET /chain/{chain}/token/{address}/holders` | Paginated ERC-20 token holders |
| `GET /collections/{slug}/holders` | Paginated NFT collection holders |
| `GET /collections/{slug}` | Collection metadata |
| `GET /collections/{slug}/stats` | Floor price, volume |
| `GET /chain/{chain}/token/{address}` | Token metadata (name, symbol) |
| `GET /accounts/{address}` | Profile enrichment for overlap wallets |

## Local development

### Cloudflare Workers

```bash
cp .dev.vars.example .dev.vars
# Fill in OPENSEA_API_KEY, CREATOR_ADDRESS, HOLDER_TOOL_ID
npx wrangler dev
```

### Vercel

```bash
cp .env.local.example .env.local
# Fill in OPENSEA_API_KEY, CREATOR_ADDRESS, HOLDER_TOOL_ID
npx vercel dev
```

## Registration

Registering an ERC-721 holder gate takes two transactions: `registerTool`
mints the `toolId` and points it at the canonical `ERC721OwnerPredicate`,
then `set-collections` populates the gate's collection list. Until the
second call lands, the predicate has no collections and grants no access.

Both commands read `PRIVATE_KEY` from the environment; the wallet must
match the manifest's `creatorAddress`. Pass `--rpc-url` for a mainnet
endpoint you control (gas estimation + broadcast).

```bash
# 1. Register (mints toolId, sets the ERC721OwnerPredicate)
PRIVATE_KEY=0x... npx @opensea/tool-sdk register \
  --metadata https://your-deploy.example.com/.well-known/ai-tool/token-nft-overlap.json \
  --network mainnet \
  --nft-gate 0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4 \
  --rpc-url https://your-mainnet-rpc

# 2. Configure the gate collection (use the toolId printed above)
PRIVATE_KEY=0x... npx @opensea/tool-sdk set-collections <toolId> \
  0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4 \
  --network mainnet \
  --rpc-url https://your-mainnet-rpc
```

The returned `toolId` goes into the `HOLDER_TOOL_ID` env var. Add
`--dry-run` to either command to preview without sending a transaction.
Verify the result with `npx @opensea/tool-sdk inspect --tool-id <toolId> --network mainnet`.

## Architecture

```
src/manifest.ts   → defineManifest({ pricing: [], access: ERC721 gate })
src/paywall.ts    → [predicateGate({ toolId })]  — no x402
src/handler.ts    → createToolHandler with overlap logic
src/opensea.ts    → thin wrapper around api.opensea.io/api/v2
src/schemas.ts    → Zod + JSON Schema for inputs/outputs
src/index.ts      → Cloudflare Workers entry point
api/index.ts      → Vercel serverless function
api/well-known/   → Vercel well-known manifest route
```
