# NFT appraiser tool

> [!NOTE]
> **Reference implementation.** This example ships with
> `@opensea/tool-sdk` and shows an ERC-8257 tool with two access tiers:
> a public x402 paywall and a discounted holder tier behind
> `ERC721OwnerPredicate`. Start your own tool from this code. The live
> `nft-appraisal-tool.vercel.app` deploy and its registered tool IDs are
> illustrative, not a production service, and may change or go offline
> without notice.

An [ERC-8257](https://eips.ethereum.org/EIPS/eip-8257) agent tool that
returns a structured price appraisal for any NFT: a low / mid / high
range, confidence, reasoning, recent sales, and comparable listings.
Callers pay per call in USDC on Base through the [x402 protocol](https://x402.org).

Built with [`@opensea/tool-sdk`](https://github.com/ProjectOpenSea/tool-sdk),
the [OpenSea v2 REST API](https://docs.opensea.io/reference/api-overview),
and Anthropic's Claude Sonnet for the appraisal reasoning.

## Live deployment

The tool is registered on Base mainnet's `ToolRegistry` v0.2
([`0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`](https://basescan.org/address/0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1#code))
and served at https://nft-appraisal-tool.vercel.app.

| Tier | Endpoint | Price | Gating | Tool ID |
|------|----------|-------|--------|---------|
| Public | `/api` | $0.05 USDC | Open access | [1](https://basescan.org/tx/0x000c4664fdec1eb06a552d5dd43da3c296be9849a0e065d90348f06cb2bfdfa2) |
| CHONK holder | `/api/holder` | $0.01 USDC | x402 payment + ERC-721 ownership of [CHONKs on Base](https://opensea.io/assets/base/0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9) | [2](https://basescan.org/tx/0x9e24fb1055af17297969da7ba8b3c7ffc8c26294d448a623c0cccded1ebc8300) |

Manifests:
- https://nft-appraisal-tool.vercel.app/.well-known/ai-tool/nft-appraiser.json
- https://nft-appraisal-tool.vercel.app/.well-known/ai-tool/nft-appraiser-chonks.json

## Calling the tool

`POST` to either endpoint with a JSON body:

```json
{
  "chain": "ethereum",
  "contractAddress": "0x79fcdef22feed20eddacbb2587640e45491b757f",
  "tokenId": "4707"
}
```

Without a payment proof, the response is an `HTTP 402` with x402
`PaymentRequirements`. With a valid signed payment (from a CHONK holder's
wallet on the holder route), the response is a structured appraisal.

### Wallet configuration

`tool-sdk pay`, `register`, `update-metadata`, and the other signing
commands use one of five wallet adapters. Set your provider's env vars and
the SDK detects it (priority: Privy → Fireblocks → Turnkey → Bankr →
PrivateKey), or pin one with `--wallet-provider <name>`.

| Provider | `--wallet-provider` | Required env vars |
|----------|---------------------|-------------------|
| Privy | `privy` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` |
| Fireblocks | `fireblocks` | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET`, `FIREBLOCKS_VAULT_ID` |
| Turnkey | `turnkey` | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_WALLET_ADDRESS`, `TURNKEY_RPC_URL` |
| Bankr | `bankr` | `BANKR_API_KEY` |
| Private Key | `private-key` | `PRIVATE_KEY`, `RPC_URL` |

The examples below use `PRIVATE_KEY` for brevity. Swap in your
provider's env vars to use another adapter; the SDK signs the same way
with each. For example, the public-tier call with a Privy server
wallet:

```bash
PRIVY_APP_ID=... PRIVY_APP_SECRET=... PRIVY_WALLET_ID=... \
  npx @opensea/tool-sdk pay https://nft-appraisal-tool.vercel.app/api \
    --body '{"chain":"ethereum","contractAddress":"0x79fcdef22feed20eddacbb2587640e45491b757f","tokenId":"4707"}'
```

Or with Bankr:

```bash
BANKR_API_KEY=... \
  npx @opensea/tool-sdk pay https://nft-appraisal-tool.vercel.app/api \
    --body '{"chain":"ethereum","contractAddress":"0x79fcdef22feed20eddacbb2587640e45491b757f","tokenId":"4707"}'
```

### Public tier ($0.05): `tool-sdk pay`

`tool-sdk pay` (added in `@opensea/tool-sdk` 0.7.0) probes the endpoint
for `PaymentRequirements`, signs the EIP-3009
`transferWithAuthorization`, and replays the request with the
`X-Payment` header.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk pay https://nft-appraisal-tool.vercel.app/api \
    --body '{"chain":"ethereum","contractAddress":"0x79fcdef22feed20eddacbb2587640e45491b757f","tokenId":"4707"}'
```

### Holder tier ($0.01, requires holding a CHONK): `tool-sdk pay`

`pay` gets a single 402 challenge, signs the EIP-3009
`transferWithAuthorization` as the `X-Payment` header, and retries. That
one signature proves identity and pays. The wallet must hold a CHONK on
Base, or `paidPredicateGate` returns `403` before any payment settles.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk pay https://nft-appraisal-tool.vercel.app/api/holder \
    --body '{"chain":"ethereum","contractAddress":"0x79fcdef22feed20eddacbb2587640e45491b757f","tokenId":"4707"}'
```

`scripts/paid-call.ts` and `scripts/paid-holder-call.ts` predate the SDK
CLI. They hand-roll the same flow with viem and assert post-conditions
(for example, that the gate settled the payment). Use them for regression
checks; ordinary calls don't need them.

## Architecture

```
client (POST + X-Payment)
  │
  ▼
api/index.ts (public)        ─┐
api/holder.ts (holder)       ─┤── @opensea/tool-sdk: createToolHandler
api/well-known/[slug].ts     ─┘    + gates [x402 paywall | paidPredicateGate]
  │
  ▼
src/handler.ts ──► src/appraisal.ts ──► OpenSea v2 + Claude Sonnet
                              │
                              ▼
                   structured JSON appraisal
```

One handler runs on both Vercel (entry: `api/`) and Cloudflare Workers
(entry: `src/index.ts`) through the SDK's runtime adapters. The two tiers
share the appraisal pipeline and differ only in their gate.

The public tier uses the x402 paywall alone: anonymous, $0.05 per call.

The holder tier uses `paidPredicateGate`, which checks identity and
payment in one 402 round trip. The onchain `accessPredicate` for
`toolId=2` is the
[`ERC721OwnerPredicate` (v0.2)](https://basescan.org/address/0xc8721c9a776958ffffeb602da1b708bf1d318379#code),
configured with the CHONK collection. Callers whose payment signer passes
`tryHasAccess(2, caller)` get the discounted price.

## Local development

```bash
cp .env.local.example .env.local
# Fill in OPENSEA_API_KEY, ANTHROPIC_API_KEY, CREATOR_ADDRESS,
# RECIPIENT_ADDRESS. Optional: HOLDER_TOOL_ID for the /api/holder
# route, BASE_RPC_URL to override the Base mainnet RPC.

pnpm install --ignore-workspace
pnpm run type-check         # tsc --noEmit

# Confirm the x402 gate fires locally (no live calls, no API keys needed):
npx @opensea/tool-sdk dry-run-gate --manifest ./manifest.json \
  --input '{"chain":"base","contractAddress":"0x000000000000000000000000000000000000dEaD","tokenId":"1"}'

# Hit the live deploy with a real payment:
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk pay https://nft-appraisal-tool.vercel.app/api \
    --body '{"chain":"ethereum","contractAddress":"0x79fcdef22feed20eddacbb2587640e45491b757f","tokenId":"4707"}'
```

To run locally, use either:
- `pnpm run dev:vercel` (runs `vercel dev`, requires linking the project)
- `pnpm run dev:cf` (runs `wrangler dev`; copy `.dev.vars.example` to
  `.dev.vars` and fill in the same env values)

## Project structure

```
api/                     Vercel runtime entries (paths under /api)
  index.ts               public tier
  holder.ts              holder tier
  well-known/[slug].ts   manifest dispatcher
src/                     framework-agnostic core
  index.ts               Cloudflare Workers entry
  handler.ts             tool handler factory
  manifest.ts            public + holder manifests
  paywall.ts             public + holder gate builders
  appraisal.ts           OpenSea + Claude pipeline
  opensea.ts             OpenSea v2 client
  prompts.ts             Claude system prompts
  schemas.ts             zod input/output schemas
scripts/                 operational scripts (smoke tests, paid calls,
                         registration verifier)
public/index.html        landing page served at the root URL
```

## Deploying your own

1. **Provision env vars** in your hosting platform:

   ```
   OPENSEA_API_KEY      # https://docs.opensea.io/reference/api-keys
   ANTHROPIC_API_KEY    # https://console.anthropic.com/
   CREATOR_ADDRESS      # lowercase 0x-prefixed; wallet that signs registerTool
   RECIPIENT_ADDRESS    # lowercase 0x-prefixed; payout wallet for x402 USDC
   TOOL_ENDPOINT        # base URL of the deploy (no trailing path)
   ```

   The holder tier also needs `HOLDER_TOOL_ID`, the `toolId` that
   `tool-sdk register` returns in step 3.

2. **Deploy** to Vercel (`vercel deploy --prod`) or Cloudflare Workers
   (`wrangler deploy`). Confirm `/.well-known/ai-tool/nft-appraiser.json`
   serves your `endpoint` URL.

3. **Register on Base mainnet**.

   Public tier:

   ```bash
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk register \
       --metadata "$DEPLOY_URL/.well-known/ai-tool/nft-appraiser.json" \
       --network base
   ```

   Holder tier: pass `--nft-gate <collection-address>` to gate the tool
   on ERC-721 ownership. The CLI uses the canonical
   `ERC721OwnerPredicate` deployment for the network as the access
   predicate, then prints the follow-up `set-collections` command:

   ```bash
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk register \
       --metadata "$DEPLOY_URL/.well-known/ai-tool/nft-appraiser-chonks.json" \
       --nft-gate $YOUR_COLLECTION_ADDRESS \
       --network base

   # then, as the register output instructs:
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk set-collections $HOLDER_TOOL_ID $YOUR_COLLECTION_ADDRESS \
       --network base
   ```

   (Or pair `--access-predicate` with `--predicate-config '{"collections":["0x..."]}'`
   to register and configure in one command.)

4. **Verify** the registration and gate state:

   ```bash
   npx @opensea/tool-sdk inspect --tool-id <toolId> --network base
   ```

   `tool-sdk inspect` reads the onchain `ToolConfig`, fetches the live
   manifest, recomputes its JCS keccak256 hash against `manifestHash`,
   and probes the access predicate if there is one.
   `scripts/read-tool-registration.ts` also asserts that the predicate's
   collection list is non-empty.

## License

MIT. See [LICENSE](./LICENSE).
