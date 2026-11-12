# Wallet personality tool

> [!NOTE]
> **Reference implementation.** This example ships with
> `@opensea/tool-sdk` and shows an ERC-8257 tool with two access tiers:
> an x402 paywall and a `SubscriptionPredicate` gate. Start your own tool
> from this code. The live `wallet-personality-tool.vercel.app` deploy and
> its registered tool IDs (3 and 4 on Base) are illustrative, not a
> production service, and may change or go offline without notice.

An [ERC-8257](https://eips.ethereum.org/EIPS/eip-8257) agent tool that
turns a wallet's onchain history into a markdown personality file. The
output is structured so a downstream LLM agent can load it as a system
prompt and act *as* the wallet. A person can read it as a vibe report.

Built with [`@opensea/tool-sdk`](https://github.com/ProjectOpenSea/tool-sdk),
the [OpenSea v2 REST API](https://docs.opensea.io/reference/api-overview),
and Anthropic's Claude Sonnet for the personality synthesis.

## Live deployment

Registered on Base mainnet's `ToolRegistry` v0.2
([`0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`](https://basescan.org/address/0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1#code))
and served at https://wallet-personality-tool.vercel.app.

| Tier | Endpoint | Price | Gating | Tool ID |
|------|----------|-------|--------|---------|
| Public | `/api` | $0.05 USDC | Open access | [3](https://basescan.org/tx/0x63b79b68a234572517bf1309ec06409e558827b88eeab289cb1dc6019b575145) |
| Subscriber | `/api/subscriber` | Free | EIP-3009 auth + active subscription on Base, via `SubscriptionPredicate` | [4](https://basescan.org/tx/0xfe172b4796b7e01f3f13ff15b8395239797cb10191567ecd6c58922266abf99d) |

Manifests:
- https://wallet-personality-tool.vercel.app/.well-known/ai-tool/wallet-personality.json
- https://wallet-personality-tool.vercel.app/.well-known/ai-tool/wallet-personality-subscriber.json

## Calling the tool

`POST` to either endpoint with an optional JSON body:

```json
{ "targetAddress": "0x..." }
```

If `targetAddress` is omitted, the subscriber route uses the
authenticated caller (recovered from the EIP-3009 signature). The response
is a structured personality plus an assembled markdown blob (see
`ResponseSchema` in `src/schemas.ts`).

### Wallet configuration

`tool-sdk pay`, `register`, and the other signing commands use one of five
wallet adapters. Set your provider's env vars and the SDK detects it
(priority: Privy → Fireblocks → Turnkey → Bankr → PrivateKey), or pin one
with `--wallet-provider <name>`.

| Provider | `--wallet-provider` | Required env vars |
|----------|---------------------|-------------------|
| Privy | `privy` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` |
| Fireblocks | `fireblocks` | `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET`, `FIREBLOCKS_VAULT_ID` |
| Turnkey | `turnkey` | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_WALLET_ADDRESS`, `TURNKEY_RPC_URL` |
| Bankr | `bankr` | `BANKR_API_KEY` |
| Private Key | `private-key` | `PRIVATE_KEY`, `RPC_URL` |

The examples below use `PRIVATE_KEY` for brevity. Swap in your
provider's env vars to use another adapter; the SDK signs the same way
with each.

### Public tier ($0.05): `tool-sdk pay`

`tool-sdk pay` probes the endpoint for `PaymentRequirements`, signs the
EIP-3009 `transferWithAuthorization`, and replays the request with the
`X-Payment` header.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk pay https://wallet-personality-tool.vercel.app/api \
    --body '{"targetAddress":"0x..."}'
```

### Subscriber tier (free, requires holding the subscription NFT): `tool-sdk pay`

`pay` gets a zero-value 402 challenge, signs the EIP-3009
`transferWithAuthorization` as the `X-Payment` header, and retries. The
wallet must hold an active subscription on Base, or `predicateGate`
returns `403` before the handler runs.

```bash
PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
  npx @opensea/tool-sdk pay https://wallet-personality-tool.vercel.app/api/subscriber \
    --body '{}'
```

## Architecture

```
client (POST + X-Payment)
  │
  ▼
api/index.ts (public)        ─┐
api/subscriber.ts            ─┤── @opensea/tool-sdk: createToolHandler
api/well-known/[slug].ts     ─┘    + gates [x402 paywall | predicateGate]
  │
  ▼
src/handler.ts ──► src/digest.ts ──► OpenSea v2
                          │
                          ▼
              src/personality.ts ──► Claude Sonnet ──► structured personality
                          │
                          ▼
                  src/markdown.ts ──► assembled markdown
```

The handler is framework-agnostic. The tiers differ only in their gate.

The public tier uses the x402 paywall alone: anonymous, $0.05 per call.

The subscriber tier uses `predicateGate` alone. The onchain
`accessPredicate` for toolId=4 is the
[`SubscriptionPredicate` (v0.2)](https://basescan.org/address/0xcbe0cd9b1d99d95baa9c58f2767246c52e461f25#code),
configured with the subscription collection. Callers whose EIP-3009
signature passes `tryHasAccess(4, caller)` call for free.

## Local development

```bash
cp .env.local.example .env.local
# Fill in OPENSEA_API_KEY, ANTHROPIC_API_KEY, CREATOR_ADDRESS,
# RECIPIENT_ADDRESS, SUBSCRIPTION_COLLECTION. SUBSCRIBER_TOOL_ID is
# required by the /api/subscriber route once you've registered.

pnpm install --ignore-workspace
pnpm run type-check         # tsc --noEmit
pnpm run test               # vitest

# Confirm the predicate gate issues its 402 locally (no live calls, no API keys):
pnpm run export-manifest
npx @opensea/tool-sdk dry-run-predicate-gate \
  --manifest ./manifest-subscriber.json \
  --tool-id $SUBSCRIBER_TOOL_ID --operator-address $CREATOR_ADDRESS
```

For a local runtime, run `pnpm run dev` (vercel dev; requires linking
the project).

## Project structure

```
api/                     Vercel runtime entries
  index.ts               public tier
  subscriber.ts          subscriber tier
  well-known/[slug].ts   manifest dispatcher
src/                     framework-agnostic core
  index.ts               public re-exports
  handler.ts             tool handler factory
  manifest.ts            public + subscriber manifests
  paywall.ts             public paywall + subscriber gates
  digest.ts              OpenSea v2 → WalletDigest
  opensea.ts             OpenSea v2 client
  personality.ts         Claude pipeline → Personality
  prompts.ts             SYSTEM_PROMPT + renderDigest
  markdown.ts            assembleMarkdown + GUARDRAILS_BLOCK
  schemas.ts             zod + JSON Schema (kept in lockstep)
scripts/
  export-manifest.ts        write public + subscriber manifests
contracts/
  SubscriptionNFT.sol       reference ERC-721 + ERC-5643 subscription collection
public/index.html           landing page served at the root URL
```

## Deploying your own

1. **Provision env vars** in your hosting platform:

   ```
   OPENSEA_API_KEY          # https://docs.opensea.io/reference/api-keys
   ANTHROPIC_API_KEY        # https://console.anthropic.com/
   CREATOR_ADDRESS          # lowercase 0x-prefixed; signs registerTool
   RECIPIENT_ADDRESS        # lowercase 0x-prefixed; x402 USDC payout wallet
   SUBSCRIPTION_COLLECTION  # subscription NFT contract on Base (reference impl in ./contracts/SubscriptionNFT.sol; not for production)
   TOOL_ENDPOINT            # base URL of the deploy (no trailing path)
   ```

   The subscriber tier also needs `SUBSCRIBER_TOOL_ID`, the `toolId` that
   `tool-sdk register` returns in step 3.

2. **Deploy** to Vercel (`vercel deploy --prod`). Confirm
   `/.well-known/ai-tool/wallet-personality.json` and
   `/.well-known/ai-tool/wallet-personality-subscriber.json` both serve.

3. **Register on Base mainnet**.

   Public tier (no predicate):

   ```bash
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk register \
       --metadata "$DEPLOY_URL/.well-known/ai-tool/wallet-personality.json" \
       --network base
   ```

   Subscriber tier: register against the canonical
   `SubscriptionPredicate` on Base and configure the gate in one command:

   ```bash
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk register \
       --metadata "$DEPLOY_URL/.well-known/ai-tool/wallet-personality-subscriber.json" \
       --access-predicate 0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25 \
       --predicate-config '{"collection":"0xYOUR_SUBSCRIPTION_NFT","minTier":0}' \
       --network base
   ```

   Or register first and configure the predicate separately:

   ```bash
   PRIVATE_KEY=0x... RPC_URL=https://mainnet.base.org \
     npx @opensea/tool-sdk configure-subscription <TOOL_ID> \
       0xYOUR_SUBSCRIPTION_NFT --network base
   ```

4. **Verify** the registration and gate state:

   ```bash
   npx @opensea/tool-sdk inspect --tool-id <toolId> --network base
   ```

   `tool-sdk inspect` reads the onchain `ToolConfig`, fetches the live
   manifest, recomputes its JCS keccak256 hash against `manifestHash`,
   and probes the access predicate.

## License

MIT. See [LICENSE](./LICENSE).
