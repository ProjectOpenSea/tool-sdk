# @opensea/tool-sdk

## 0.3.1

### Patch Changes

- 16f4b7e: Re-export `BankrAdapter` and `BankrConfig` from `@opensea/wallet-adapters`. `createWalletFromEnv()` already auto-detects Bankr when `BANKR_API_KEY` is set; this makes the named adapter directly importable from `@opensea/tool-sdk` for callers that need to construct it explicitly.
- Updated dependencies [a81071b]
  - @opensea/wallet-adapters@0.2.0

## 0.3.0

### Minor Changes

- ef922d8: Migrate `auth` and `smoke` CLI commands from `TOOL_SDK_PRIVATE_KEY` / `privateKeyToAccount` to `createWalletFromEnv()` from `@opensea/wallet-adapters`. Both commands now use `PRIVATE_KEY` (via wallet-adapters) instead of the non-standard `TOOL_SDK_PRIVATE_KEY` env var, and accept the `--wallet-provider` flag for explicit provider selection. This makes wallet configuration consistent across all CLI commands (`auth`, `pay`, `smoke`, `register`, `update-metadata`).

  **Breaking:** `--key` (auth), `--as` (smoke), and `TOOL_SDK_PRIVATE_KEY` env var have been removed. Use `PRIVATE_KEY` + `RPC_URL` env vars or `--wallet-provider` instead.

- f6ef66e: feat: add delegated agent auth via delegate.xyz for predicate-gated tools
- 80bfd16: feat(manifest): validate inputs/outputs as well-formed JSON Schema
- fde8ef0: feat: add ERC721OwnerPredicateClient and ERC1155OwnerPredicateClient for managing predicate collections
- 6b31470: feat(predicate-gate): accept registryAddress override for local development

  `PredicateGateConfig` and `ToolRegistryClient` now accept an optional `registryAddress` field. When provided, the middleware and client use the given address instead of looking up the canonical `TOOL_REGISTRY` deployment. This enables local development against a forked Anvil node or a custom registry deploy without monkey-patching the SDK.

- 1368f61: feat: support runtime env resolution in defineManifest for Cloudflare Workers

### Patch Changes

- 1b3a388: feat(init): update Vercel template with agent-friendly discovery page and llms.txt

  The `tool-sdk init` template now scaffolds an index.html that serves as an
  llms.txt-style discovery page — showing agents the manifest location, endpoint,
  auth requirements (SIWE), input/output schemas, and SDK usage examples. Also adds
  a `/llms.txt` plaintext file following the llms.txt spec for direct LLM consumption.

  Updated to use `createWalletFromEnv` / `walletAdapterToClient` from
  `@opensea/wallet-adapters` instead of raw `privateKeyToAccount`. Added coverage
  for x402 payment flows (`pay` command, `paidAuthenticatedFetch`), smoke-testing,
  and multi-provider wallet configuration (Privy, Turnkey, Fireblocks).

- b5307e4: fix(deploy): skip blank-valued env vars in .env.local.example during deploy wizard
- 7da1fae: fix(deploy): skip env var prompts for vars already set in Vercel

## 0.2.0

### Minor Changes

- 997510c: Add endpoint probe to verify, inspect, and smoke commands to catch routing defects (405, 404) before signing or declaring success
- dca9933: Add paidAuthenticatedFetch for predicate+paywall composite gates; add --paid flag to smoke command; add inspect warning for composite-gated tools
- 181f647: Point ERC721_OWNER_PREDICATE / ERC1155_OWNER_PREDICATE at v0.2 deployments on Base. The new predicates implement `getRequirements()` (F18 access-requirement introspection); existing v0.1 addresses are no longer canonical. Tools registered against the v0.1 ToolRegistry are unaffected — only the predicate addresses moved. Tools that delegated access to the v0.1 predicates will need `setAccessPredicate` to repoint at the new addresses.

## 0.1.2

### Patch Changes

- Add `repository` field to `package.json` so npm provenance can validate the bundle against the public mirror at `https://github.com/ProjectOpenSea/tool-sdk`. The 0.1.1 tag/release exists but never reached npm because of this missing field; 0.1.2 is the first version actually on npm.

## 0.1.1

### Patch Changes

- 905ed4a: Initial release of `@opensea/tool-sdk` — SDK and CLI for building ERC-XXXX compliant AI agent tools.

  ### Core SDK

  - `createToolHandler` for building tools with manifest validation, JCS keccak256 hashing, well-known endpoint middleware, and a `GateMiddleware` chain.
  - Framework adapters for Vercel, Cloudflare, and Express. Includes `VercelRequest`/`VercelResponse`/`ExpressRequest`/`ExpressResponse` type exports.
  - `ToolHandlerError` for typed HTTP status codes; unhandled errors are logged automatically.
  - `ToolManifestSchema` with optional `verifiability` block (tier, execution, dataRetention, sourceVisibility, attestation, reproducibleBuild).

  ### Onchain integration

  - `ToolRegistryClient` with `registerTool`, `setAccessPredicate`, `tryHasAccess`, and `listToolsByCreator`.
  - Canonical CREATE2 deployments on Base mainnet: `TOOL_REGISTRY` (v0.1), `ERC721_OWNER_PREDICATE`, `ERC1155_OWNER_PREDICATE`. Each is a `Deployment` object (`{ address, chains, overrides? }`); resolve per-chain with `deploymentAddress(deployment, chainId)`.
  - `register` CLI enforces `creatorAddress` matches the signing wallet per ERC-XXXX spec.
  - `IAccessPredicate` (interface ID `0xbdf9dc18`) and `IToolRegistry` ABIs exported, including `name()` / `version()` view methods. Predicates expose machine-readable access requirements via `getRequirements(toolId)` returning `AccessRequirement[]` with `RequirementLogic` (AND/OR). Marker interfaces `IERC721Holding`, `IERC1155Holding`, `ISubscription` shipped via `IRequirementTypes.sol`.

  ### Access gates

  - `predicateGate({ toolId })` middleware delegates the access decision to the onchain `ToolRegistry` so the registered access predicate is the single source of truth. One middleware works for every predicate type (single-collection, multi-collection, ERC-1155, subscriptions, composites, future predicates) without per-predicate SDK changes; on-chain `setAccessPredicate` updates are picked up automatically. Returns 403 with the predicate address on `(true, false)`, 502 on predicate misbehavior.
  - `checkToolAccess` is the client-side preview of `predicateGate` (no SIWE) for frontends and CLIs that want to gate UI before invocation.
  - `nftGate` is `@deprecated` in favor of `predicateGate` for any registered tool. It remains exported for local development against unregistered tools.
  - SIWE auth helpers: `createSiweMessage`, `authenticatedFetch`. Now also accepts external signers (Bankr, MPC, HSM) for agent wallets.

  ### x402 paywall gates

  - `x402Gate` — lower-level gate for self-hosted facilitators.
  - `payaiX402Gate` — uses the PayAI community facilitator (`https://facilitator.payai.network`, no auth, free); recommended for prototyping.
  - `cdpX402Gate` — uses Coinbase Developer Platform (`https://api.cdp.coinbase.com/platform/v2/x402`); accepts a `createAuthHeaders` callback for the CDP JWT auth.
  - All hosted gates settle on chain after the handler succeeds — they invoke `/settle` once the response validates against the schema, moving USDC from payer to recipient and recording the settled tx hash on `ctx.gates.x402.settlementTxHash`. Settlement is synchronous (up to 10s timeout); failures log `[tool-sdk] gate.settle failed:` but the response still returns 200. Operators running their own facilitator via `x402Gate` are responsible for settlement.
  - `defineToolPaywall` helper prevents pricing/gate config drift between the manifest and the gate.
  - Recipient address validation rejects zero and burn addresses.
  - Client helpers: `signX402Payment` (signs an EIP-3009 `TransferWithAuthorization` for USDC, returns base64-encoded `X-Payment` header value) and `paidFetch` (drop-in fetch wrapper that handles the 402 challenge automatically).
  - `GateMiddleware` gains an optional `settle?(ctx)` hook called by `createToolHandler` after a successful run.

  ### Wallet adapters

  - Wallet provider auto-detection across Privy, Turnkey, Fireblocks, and PrivateKey via the shared `@opensea/wallet-adapters` package. CLI accepts `--wallet-provider` to override.
  - `walletAdapterToClient` delegates to `@opensea/wallet-adapters/viem` (`walletAdapterToViemClient`).
  - Replaces the old `TOOL_SDK_PRIVATE_KEY` env var with the `WalletAdapter` abstraction.

  ### CLI commands

  - `init` — project scaffolding (Vercel/Express/Cloudflare templates) with TS-manifest support.
  - `validate`, `hash`, `export` — also accept TypeScript manifest files.
  - `verify`, `register`, `update-metadata` — manifest lifecycle.
  - `inspect` — shows predicate type, ERC-721/1155 collections, and accepts `--check-access`.
  - `pay` — pay a paywalled tool from the CLI.
  - `auth` — SIWE-authenticated calls to predicate-gated tools.
  - `dry-run-gate`, `dry-run-predicate-gate` — test gate setup locally before deploy.
  - `deploy --host vercel` — one-command deploy: login check, project link (auto-configured with inferred project and scope), env var setup from `.env.local.example` (with sensitive-input masking), first deploy, `TOOL_ENDPOINT` configuration, force redeploy, and manifest verification. Recovers from non-zero vercel exit when a URL was issued.
  - `smoke` — production endpoint verification.

  ### Documentation

  - README with full CLI reference (export, update-metadata, inspect, deploy, pay, auth, dry-run-gate, dry-run-predicate-gate).
  - Predicate gating + SIWE authentication guides.
  - Hosting comparison, migration guide, and FAQ.
  - MIT LICENSE.

  ### Breaking changes

  The `IAccessPredicate` ERC-165 interface ID changed from `0xa11ea958` to `0xbdf9dc18` due to the addition of `getRequirements()` and `name()`. Third-party predicate implementations must add both functions and report the new interface ID; existing predicates that declared support for the old ID will fail registration via `_validatePredicate` until updated. Permissive predicates that do not declare ERC-165 support are unaffected.

  `TOOL_REGISTRY_ADDRESS` (chain-keyed map) → `TOOL_REGISTRY` (`Deployment` object). `ERC721_OWNER_PREDICATE` and `ERC1155_OWNER_PREDICATE` shape changed from `Record<number, address | undefined>` to `Deployment`. Use `deploymentAddress(deployment, chainId)` to resolve an address for a specific chain.

  `PaidFetchOptions.account` renamed to `signer` (type widened to `WalletAdapter | Account`). `signX402Payment({ account })` renamed to `signX402Payment({ signer })`. `createWalletFromEnv(provider?)` no longer accepts an optional provider argument — use `createWalletForProvider(provider)` instead. `createWalletFromEnv()` no longer emits `console.warn` on multi-provider configs; it silently picks the highest-priority provider.

  The `register` CLI's `--nft-gate <address>` flag now configures the canonical multi-tenant `ERC721OwnerPredicate` via `setCollections(toolId, [collection])` after registration, instead of deploying a per-collection predicate. `setCollections` is gated to the tool's creator and the predicate reads the authoritative creator from the registry on every write. If `registerTool` succeeds but `setCollections` fails, the tool is registered with an unconfigured gate and `hasAccess` returns false for everyone — the CLI surfaces transaction details so the creator can re-run `setCollections` manually.

- 959d87f: Sync tool-sdk with recent tool-registry updates:

  - **ABI completeness**: Add missing `ToolMetadataUpdated` and `AccessPredicateUpdated` events to `IToolRegistryABI`; add `hasAccess` to `IAccessPredicateABI` to match the full Solidity interface
  - **New predicate ABIs**: Add `SubscriptionPredicateABI` (configureToolGating, getToolGatingConfig, getSubscriptionStatus) and `CompositePredicateABI` (setComposition, getOp, getTerms) with events
  - **ToolRegistryClient**: Add `name()` and `version()` methods for onchain identity introspection
  - **inspect CLI**: Display access requirements via `getRequirements` for any predicate; show SubscriptionPredicate config (collection, minTier) and CompositePredicate terms (op, leaf predicates, negation)
