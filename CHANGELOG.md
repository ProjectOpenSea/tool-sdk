# @opensea/tool-sdk

## 0.22.0

### Minor Changes

- c80dc52: Migrate `paidFetch`, `paidAuthenticatedFetch`, and the `pay` CLI to use `@x402/core` client infrastructure (`x402Client`, `x402HTTPClient`, `SchemeNetworkClient`) for payment payload creation and header encoding. Adds `ExactEip3009Scheme` adapter wrapping tool-sdk's existing EIP-3009 signing into the standard x402 scheme interface. No public API changes.

## 0.21.0

### Minor Changes

- 6c1be9c: `createToolHandler` now fires the usage report through a platform `waitUntil` (keep-alive-after-response) when one is available, instead of awaiting it inline. This removes reporting latency from every successful call and closes a billing edge case: because x402 settlement runs before the report, awaiting the report meant a function freeze in that window could charge a paid caller without returning a result. With `waitUntil` the response flushes first and the report runs after.

  It's automatic for most tools: the Vercel request-context `waitUntil` is auto-detected (no dependency on `@vercel/functions`), and `toCloudflareHandler` now wires the per-request `ctx.waitUntil` (its `fetch` signature gains the optional `ctx` argument). A new optional `waitUntil` option on `ToolHandlerConfig` lets you override detection or support another runtime. When no `waitUntil` is available (long-running servers, or serverless lacking it), the report is awaited as before so it still fires before any freeze.

### Patch Changes

- 09f20a7: The `init` Vercel template now sets `export const maxDuration = 60` on the tool entrypoint. Tools that call an LLM or other slow upstream routinely exceed Vercel's 10s Hobby default, which returns a 502 to the caller; because x402 settlement runs after the handler succeeds, a timeout in the settle/report window can also charge the caller without returning a result. 60s is the Hobby maximum and valid on Pro/Enterprise.

## 0.20.1

### Patch Changes

- 16c3380: Refine caller-side usage reporting:

  - The `pay` CLI now sends a usage report by default; pass `--no-report-usage` to opt out.
  - `--api-key` falls back to the `OPENSEA_API_KEY` env var before auto-provisioning an instant key (avoids the rate-limited provisioning endpoint when a key is already available).
  - A "duplicate" rejection (the tool's own server-side reporter already recorded the settlement) is treated as success rather than logged as an error.
  - `reportCallerX402Usage` / `reportCallerEip3009Usage` now return a `CallerUsageReportResult` (`reported` | `already-reported` | `skipped` | `failed`) so callers can surface an accurate status. The `pay` CLI uses it to print the real outcome.

- `paidFetch` and `paidAuthenticatedFetch` now throw `X402PaymentError` when the server responds with a 5xx status after a payment is sent (e.g. 502, 504), instead of silently returning the error response. The error exposes `response` and `settled` (whether `PAYMENT-RESPONSE` headers were present), so callers can detect a payment that may already have settled onchain and avoid unintended retries or double charges. (#441)

## 0.20.0

### Minor Changes

- e2d9789: Add caller-side usage reporting: `reportCallerX402Usage`, `reportCallerEip3009Usage`, and `extractSettlementTxHash`. Tool callers can now send usage reports by endpoint URL with auto-provisioned API keys. Integrated into `paidFetch`, `paidAuthenticatedFetch` (via `reportCallerUsage` option), and the `pay` CLI (`--report-usage`).
- e2d9789: `createToolHandler` now echoes the onchain settlement tx hash back to the caller in the x402 settlement-response header (`PAYMENT-RESPONSE` for v2, `X-PAYMENT-RESPONSE` for v1) after a paid call settles. This lets caller-side usage reporting (and any x402 client) read the tx hash via `extractSettlementTxHash`; without it, `--report-usage` silently has nothing to report. Adds the `buildSettlementResponseHeader` helper.

## 0.19.0

### Minor Changes

- b4f5114: Support x402 v2 and GET endpoints in `pay`. Bazaar-discovered x402 tools are frequently GET endpoints that speak x402 v2, where the SDK previously could not transact at all: `pay` only issued POST, only read the v1 body `accepts` challenge, and signed the v1 `X-PAYMENT` envelope.

  What changed:

  - New `x402-challenge.ts`: `resolveNetwork()` accepts `base`, `eip155:8453`, and `8453`; `parseX402Challenge()` reads the `PAYMENT-REQUIRED` header or the body and normalizes the v2 `amount` field to `maxAmountRequired`.
  - `signX402Payment` emits the version-correct envelope (v1 `{scheme,network,payload}` vs v2 `{payload,resource,accepted}`) and echoes the challenge's `x402Version`. New `x402PaymentHeaderName()` (`X-PAYMENT` for v1, `PAYMENT-SIGNATURE` for v2) and `X402_SETTLEMENT_HEADERS` exports.
  - `paidFetch` routes through the shared parser and the version-correct header.
  - `pay` command: `--method` flag (defaults to POST) with auto-fallback to GET on 404/405, query-string encoding for bodyless verbs, version-correct payment header, on-chain settlement readout, `RPC_URL` defaulting to a public Base endpoint, and clearer wallet-config errors.
  - `smoke` and `paid-authenticated-fetch` resolve networks so CAIP-2 networks still get USDC validation.

## 0.18.0

### Minor Changes

- ef12e56: Hash the manifest as served, per ERC-8257 §2. The manifest hash is now computed over the full JSON document (including any namespaced extension fields) with no schema stripping and no injected defaults, so it agrees with any RFC 8785 implementation and with the OpenSea backend. Previously the CLI validated first, which stripped unknown fields and injected a default `type`, producing a hash that could differ from the served bytes.

  What changed:

  - `computeManifestHash` now accepts the raw served or authored object and hashes it as-is. Callers must pass the full document, not a schema-stripped copy.
  - The manifest schema is now open: namespaced extension fields (reverse-DNS, e.g. `io.opensea.paymentHint`, or the legacy `x-` prefix) are preserved through validation. The `type` field is no longer defaulted, so it is hashed only when present.
  - `validate`, `hash`, and `register` warn about bare un-namespaced extension fields, which risk colliding with future normative fields.
  - New `findBareExtensionKeys(data)` export reports top-level fields that are neither defined by the schema nor namespaced. This replaces the unreleased `findUnknownManifestKeys`.

  Tools whose served manifest contains extra fields or omits `type` will now produce a different (correct) hash than prior `tool-sdk` versions. Re-register or update such tools so their onchain hash matches the served document.

## 0.17.1

### Patch Changes

- Thread `--rpc-url` through to registry reads in CLI commands. Previously the flag only applied to writes; read paths (status, get, list) fell back to the default RPC endpoint.

## 0.17.0

### Minor Changes

- Sync the manifest schema with the canonical ERC-8257 spec: `featuredImage` is now an optional field in the manifest Zod schema, so manifests declaring it pass validation.

### Patch Changes

- Remove the broken `--auth eip3009` path from the `pay` CLI command (along with its `--manifest` and `--chain` options). The flag bypassed the unified x402 flow (probe → 402 → sign X-Payment → retry) and caused 500 errors. `pay` now always uses the probe-then-sign path. Example READMEs and skill docs updated to match.

## 0.16.1

### Patch Changes

- 8812960: Require `validBefore` in predicate-gate authorizations. `verifyXPaymentAuth` previously left `validBefore` optional: a caller could sign a `TransferWithAuthorization` with `validBefore=0` and omit the field, so the expiry check was skipped and the gate accepted an unbounded, non-expiring proof. The field is now required in both the X-Payment and EIP-3009 auth paths, with the now-dead `validBefore !== undefined` guards and the `?? "0"` recovery fallback removed. Thanks @Nexory (ProjectOpenSea/tool-sdk#10).

## 0.16.0

### Minor Changes

- Add `paidPredicateGate`, a combined gate that resolves identity verification (predicate) and x402 payment in a single 402 round trip.

  Tools using `paidPredicateGate` need only 2 requests (a 402 advertising the real payment amount, then a 200) instead of 3 (predicate 402, then x402 402, then 200). The caller's `X-Payment` signature for the payment amount simultaneously proves identity, via the recovered `from` address, and authorizes the transfer. The onchain predicate is checked before the facilitator settles payment: if access is denied, the gate returns a 403 and no funds move.

  New exports: `paidPredicateGate` and `PaidPredicateGateConfig`.

## 0.15.0

### Minor Changes

- Unified 402 flow for free and paid predicate-gated tools.

  `predicateGate` now speaks the x402-style 402 challenge for both free and paid tools. When no auth is provided and `operatorAddress` is configured, it returns a 402 with `PaymentRequirements` (`payTo`=operator, `maxAmountRequired`=0) instead of a 401. The gate accepts an `X-Payment` header as the auth source (taking precedence over `Authorization`), recovers the signer from the EIP-712 `TransferWithAuthorization` payload, and extracts caller identity from the `from` field. `PaymentRequirements` are chain-aware: the network name and USDC asset address are derived from the configured chain. `x402Version` and the `exact` scheme are validated.

  **Breaking changes:**

  - `eip3009AuthenticatedFetch` and `paidAuthenticatedFetch` no longer take `chainId` or `to` params. On a 402 they sign `X-Payment` with the advertised `payTo` and retry; the redundant `Authorization: EIP-3009` header has been removed.
  - `EIP3009_CHAIN_MAP` and `ZERO_ADDRESS` exports were removed.

  **New features:**

  - `eip3009AuthenticatedFetch` gains an `allowedRecipients` guard that prevents signing `X-Payment` for arbitrary `payTo` addresses returned by a malicious 402 response, mirroring `paidAuthenticatedFetch`'s `validatePaymentSafety`.

## 0.14.2

### Patch Changes

- d7c1191: Await the `usageReporting` reporter before returning the tool response.

  Previously the handler fired the reporter fire-and-forget after the response was built. On serverless runtimes (Vercel, AWS Lambda) the function is frozen the moment the response flushes, which killed the in-flight request so the usage report silently never arrived. The handler now awaits the report (bounded by the reporter's `timeoutMs`, default 5s) so it reliably completes; failures are still caught and logged and never fail the tool call.

## 0.14.1

### Patch Changes

- 776788d: Fix usage reporting to attribute the real caller, and make reporting a service-side-only responsibility.

  - x402 usage reports now use the on-chain payer as `caller_address` (after any gate-verified caller), instead of a placeholder address.
  - EIP-3009 usage reports now forward the caller's original signed authorization, stashed by `predicateGate` on `ctx.callerAuthorization` and surfaced via `InvocationEvent.callerAuthorization`. The server no longer re-signs as itself.
  - Removed `walletClient`, `operatorAddress`, and `tokenAddress` from `Eip3009UsageReporterConfig`. Reporting is authenticated by `apiKey`, and there is no caller self-reporting or signing path. `signZeroValueAuthorization` remains exported for building `Authorization: EIP-3009` request headers.

## 0.14.0

### Minor Changes

- fc83682: Add usage reporting integration to `createToolHandler` and update reporters to match os2-core `POST /api/v2/tools/usage` endpoint.

  **Breaking changes:**

  - `Eip3009UsageReporterConfig` now requires `apiKey`, `operatorAddress`, and ERC-8257 composite key fields (`toolChainId`, `toolRegistryAddress`, `toolOnchainId`). Previously `tool_slug` was used; it has been removed.
  - Default aggregator URL changed from `https://api.opensea.io/api/v2/agent-tools/usage` to `https://api.opensea.io/api/v2/tools/usage`.
  - Base Sepolia (84532) removed from `NETWORK_USDC` map.

  **New features:**

  - `ToolHandlerConfig.usageReporting` — pass an `Eip3009UsageReporterConfig` and the handler auto-fires the reporter on every successful invocation (both free EIP-3009 and paid x402 paths). Works alongside `onInvocation`.
  - `createX402UsageReporter` — standalone reporter for paid x402 tools (no wallet signing, just settlement tx hash).
  - Per-event `txHash` hex format validation in x402 reporter.

## 0.13.0

### Minor Changes

- 8809203: Add Shape and Abstract chain support to all CLI commands. The `--network` flag now accepts `shape` and `abstract` in addition to `base` and `mainnet`.
- bddd1e1: Switch predicate gate and CLI auth from SIWE to EIP-3009.

  - `predicateGate` now accepts both `Authorization: EIP-3009 <token>` (preferred) and `Authorization: SIWE <token>` (deprecated). EIP-3009 verification uses pure `ecrecover` on EIP-712 typed data — no RPC call needed.
  - New exports: `createEip3009AuthHeader`, `eip3009AuthenticatedFetch`, `Eip3009AuthenticatedFetchOptions`.
  - Deprecated exports: `createSiweMessage`, `createSiweAuthHeader`, `authenticatedFetch`.
  - CLI `auth` command now uses EIP-3009 by default. `pay --auth siwe` (deprecated) is still accepted and silently maps to EIP-3009 with a deprecation warning.
  - Zero-value authorizations use 5-minute expiry (`validBefore`) instead of `MAX_UINT256`.

- dc56d72: Add EIP-3009 zero-value authorization for usage tracking (`signZeroValueAuthorization`, `createEip3009UsageReporter`, `onInvocation` callback on `createToolHandler`).

## 0.12.0

### Minor Changes

- ad8cf93: feat: deploy canonical ERC20BalancePredicate and default its CLIs to it

  - Set the canonical ERC20BalancePredicate address (`0x1a834FC48B5f6e119c62C12a98b32137bCFA77cD`) on Ethereum mainnet and Base in `chains.ts`, replacing the prior zero-address stub.
  - `configure-erc20-gate` and `get-erc20-config` now default to the canonical deployment; `--predicate-address` is an optional override instead of a required flag (mirrors the trait-gating CLIs from #353).

- 1ce2300: feat: add ERC20BalancePredicate support — new predicate client, ABI, CLI commands (configure-erc20-gate, get-erc20-config), and requirement decoding for ERC-20 token balance gating
- 38212f7: Add `--erc20-gate` and `--erc20-min-balance` flags to the `register` command for one-shot ERC-20 balance-gated tool registration. Also adds `--predicate-config` support for `ERC20BalancePredicate` and makes the `ERC20BalancePredicateClient` constructor use the canonical deployment address by default.
- f1636af: feat: deploy ToolRegistry + canonical predicates to Shape and Abstract

  Deterministically deployed the v0.2 `ToolRegistry` and all five canonical predicates (`ERC721OwnerPredicate`, `ERC1155OwnerPredicate`, `SubscriptionPredicate`, `TraitGatedPredicate`, `ERC20BalancePredicate`) via CREATE2 (salt `bytes32(uint256(1))`) to Shape (chain 360) and Abstract (chain 2741). All addresses are identical to the existing Ethereum mainnet and Base deployments.

  Abstract is a ZK Stack chain but runs EVM-equivalent execution, so the standard CREATE2 factory resolves the canonical addresses — no per-chain `overrides` were needed. Updated the `chains` arrays in `chains.ts` and the live-addresses table in the tool-registry README.

### Patch Changes

- 04b589b: docs: add configure-trait-gating and get-trait-config CLI reference to README

## 0.11.0

### Minor Changes

- 308e5f8: Add `configure-subscription` CLI command and wire SubscriptionPredicate support into `register --predicate-config`
- a5992e3: `configure-trait-gating` and `get-trait-config` CLI commands now default to the canonical TraitGatedPredicate deployment. The `<predicateAddress>` positional argument is replaced with an optional `--predicate-address <address>` flag for overriding the canonical address.
- ca8bd98: Add TraitGatedPredicate for ERC-7496 dynamic trait gating. New exports: `TraitGatedPredicateClient`, `TraitGatedPredicateABI`, `ERC7496_TRAIT_KIND`, `DecodedERC7496TraitRequirement`, `TRAIT_GATED_PREDICATE`.

  Canonical deployment at `0x10abF07CfA34Bf22372C57f27e8bd9C2DCF93fA1` on Ethereum mainnet and Base — `TraitGatedPredicateClient` now defaults to this address when `predicateAddress` is omitted.

## 0.10.0

### Minor Changes

- 27a89da: Canonicalize `SubscriptionPredicate` v0.2 on Ethereum mainnet and Base. The predicate now ships in `script/Deploy.s.sol` and the SDK at the same deterministic CREATE2 address on chain 1 and 8453: `0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25`.

  `SubscriptionPredicateClient` no longer requires `predicateAddress` — it defaults to the canonical deployment for the configured chain, matching `ERC721OwnerPredicateClient` and `ERC1155OwnerPredicateClient`. Pass `predicateAddress` only to target a non-canonical instance.

  New SDK export: `SUBSCRIPTION_PREDICATE` (the `Deployment` record), alongside the existing `ERC721_OWNER_PREDICATE` / `ERC1155_OWNER_PREDICATE` / `TOOL_REGISTRY`.

## 0.9.0

### Minor Changes

- 427e093: Redeploy `ToolRegistry` + canonical predicates as v0.2 on Ethereum mainnet and Base. The v0.2 registry returns `version() == "0.2"` and accepts predicates that advertise IAccessPredicate interfaceId `0xbdf9dc18` (hasAccess + name + getRequirements).

  New canonical addresses (identical on chain 1 and 8453):

  - `ToolRegistry` v0.2: `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`
  - `ERC721OwnerPredicate` v0.2: `0xc8721c9A776958FfFfEb602DA1b708bf1D318379`
  - `ERC1155OwnerPredicate` v0.2: `0x77373Dc3c1AE9A1e937eF3e5E08F4807D47c7c11`

  Pre-beta: the previous v0.1 Base deployment is dropped from the SDK entirely. Removed from `@opensea/tool-sdk`:

  - `ERC721_OWNER_PREDICATE_V1` (value export)
  - `getPredicateForRegistryVersion` (function export)
  - `PredicateKind` (type export)
  - `PredicateClientConfig.registryVersion` (option)

  The CLI commands (`register`, `set-collections`, `set-collection-tokens`, `get-collections`) no longer probe `registry.version()` to pick a predicate — they always use the canonical v0.2 predicate.

## 0.8.1

### Patch Changes

- 8bac936: Enforce ERC-8257 §Predicate Introspection Hardening ceilings in `describeToolAccess`

  `describeToolAccess` now defensively bounds the values it reads from an arbitrary access predicate so a malicious predicate cannot grief discovery surfaces with megabyte-scale returns:

  - `getRequirements()` array with more than 256 entries → empty array (fail closed)
  - Individual requirement with `data` over 4096 bytes or `label` over 256 UTF-8 bytes → substituted with the kind sentinel `0x00000000`
  - `name()` over 256 UTF-8 bytes → treated as if the predicate did not implement `name()` (returns `null`)

  The caps mirror the existing manifest-side bounds in `schema.ts` so onchain and offchain views of the same data have the same upper bounds.

- f539375: Fix `inspect` CLI to dispatch wallet-state-attestation rendering on requirement `kind`, not predicate `name()`

  The previous dispatch keyed on `predicateName === "WalletStateAttestationPredicate"`, which never matches a real deployment — third-party attestation issuers pick their own `name()` (e.g., the reference implementation returns `"InsumerAccessPredicate"`). The decoder is already keyed on `kind` (`0x7a111640`); the inspect renderer now matches.

## 0.8.0

### Minor Changes

- 6eacfbe: Add `IWalletStateAttestation` requirement type support (kind `0x7a111640`)

  - New `WALLET_STATE_ATTESTATION_KIND` constant and `DecodedWalletStateAttestationRequirement` type
  - `decodeRequirement()` now decodes wallet-state attestation data (`issuerJwksUri`, `conditionHash`)
  - CLI `inspect` command displays decoded attestation fields for `WalletStateAttestationPredicate`
  - SKILLS.md updated with WalletStateAttestation predicate documentation

## 0.7.1

### Patch Changes

- 0bb20ac: docs: update README and SKILLS.md for F4a–F4g changes

  - README: document `--nft-gate`, `--predicate-config`, `--wallet-provider`, `--rpc-url` flags on `register`
  - README: document `--auth siwe`, `--manifest`, `--chain` flags on `pay`
  - README: add CLI reference sections for `smoke`, `set-collections`, `get-collections`, `set-collection-tokens`
  - SKILLS.md: replace `cast send` with `set-collections` CLI in Example C

## 0.7.0

### Minor Changes

- 2391e1e: Add `--predicate-config` flag to `register` command (F4d)

  When `--access-predicate <addr>` is supplied, the CLI now:

  - Calls `name()` on the predicate to identify its type
  - Displays the predicate name in the registration summary
  - Accepts `--predicate-config <json>` to bundle predicate setup with registration
    - ERC721OwnerPredicate: `--predicate-config '{"collections":["0x..."]}'`
    - ERC1155OwnerPredicate: `--predicate-config '{"collection":"0x...","tokenIds":["1","2"]}'`
  - Prints a warning if `--access-predicate` is used without `--predicate-config`, explaining that the tool will accept any caller until configured
  - Validates `--access-predicate` addresses

- 1be6808: Add `set-collections`, `get-collections`, and `set-collection-tokens` CLI commands (F4c)

  - `set-collections <toolId> <addr...>` — set the ERC-721 collection gate list for an already-registered tool
  - `get-collections <toolId>` — read the current ERC-721 collection gate list
  - `set-collection-tokens <toolId> <addr> <tokenId...>` — set the ERC-1155 collection + token ID gate
  - All commands auto-detect registry version and select the matching predicate deployment
  - Supports `--dry-run`, `--wallet-provider`, `--rpc-url`, and `--network` options

- 69b30ff: Fix `--nft-gate` broken end-to-end on Base mainnet (F4a)

  The SDK hardcoded the v0.2 `ERC721OwnerPredicate` address, which is rejected by the live v0.1 registry on Base. The `register` command now queries the registry's `version()` and selects the matching predicate deployment automatically.

  - Re-added `--nft-gate <collection>` to `register` with registry-version-aware predicate selection
  - Added `ERC721_OWNER_PREDICATE_V1` deployment constant
  - Added `getPredicateForRegistryVersion()` resolver
  - Added `registryVersion` option to `PredicateClientConfig`
  - Updated `tool-registry/README.md` and `SKILLS.md` with v0.1 predicate addresses

- 2c1e552: Add `--auth siwe` flag to the `pay` CLI command. When set, uses `paidAuthenticatedFetch` (SIWE + x402 payment) instead of payment-only flow. Also auto-enables SIWE auth when `--manifest` points to a manifest with an `access` block.
- 53a49cf: Remove deprecated `nftGate` middleware and `--nft-gate` CLI flag behavior

  - Removed `nftGate` middleware (`src/lib/middleware/nft-gate.ts`) and its `NFTGateConfig` type
  - Removed `nft` field from `ToolContext.gates` and `BypassGates`
  - Re-added `--nft-gate` option to `register` with registry-version-aware predicate selection
  - Use `predicateGate` with `--access-predicate` instead for all access gating middleware

  **BREAKING:** `nftGate`, `NFTGateConfig`, and `ToolContext.gates.nft` are no longer exported. Migrate to `predicateGate({ toolId })`.

- 91d95ba: Add `SubscriptionPredicateClient` and `CompositePredicateClient` typed clients matching `tool-registry` example predicates. Add missing `CollectionsSet` event to `ERC721OwnerPredicateABI`. Fix stale v0.1 predicate addresses in SKILLS.md examples.

### Patch Changes

- b02f9b0: Treat 4xx probe responses (e.g. 400 from Zod validation) as "endpoint reachable" instead of printing a misleading WARN. Only 5xx responses are flagged as failures.
- cab7a72: Treat 402 with valid `accepts` array as auth-OK in `smoke` command

  - When a paywalled tool returns 402 with payment requirements after SIWE auth, `smoke` now exits 0 and prints: "Auth OK — paywall fired (expected for paywalled tools)."
  - The `--expect` flag no longer defaults to 200; when omitted, 402-with-accepts is auto-success. When explicitly set, the exact status code is asserted as before.

## 0.6.0

### Minor Changes

- 303247f: Add `defineVerifiability()` typed builder for verifiability blocks

  Three tier-narrowed factory methods (`selfAttested`, `hardwareAttested`, `verifiable`) produce correct verifiability objects for `defineManifest()`. Invalid tier/field combos are rejected at the TypeScript type level rather than only at validation time.

- 2095a84: Replace ERC-Draft placeholder references with officially assigned ERC-8257 number across CLI help text, documentation, and test vectors. Manifest schema `type` URL switched to the canonical ERCs site (`https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1`); test vectors and pinned hashes updated accordingly.

## 0.5.0

### Minor Changes

- 58a2b4b: Add `toManifestAccess()` to `ERC721OwnerPredicateClient` and `ERC1155OwnerPredicateClient` for programmatic manifest access generation with deterministic OpenSea collection links. Export shared requirement-kind constants (`ERC721_KIND`, `ERC1155_KIND`, `SUBSCRIPTION_KIND`).
- 480f67c: Suggest manifest `access` block when registering with `--nft-gate`

  The `register` CLI command now detects when a manifest is missing the `access` field and the user is registering with `--nft-gate`. It generates the correct access object using `ERC721OwnerPredicateClient.toManifestAccess()` and prints it as a suggestion. The preview appears in both `--dry-run` and normal mode. In normal mode the user is prompted to view copy-paste instructions for updating their manifest.

- c34fb8d: Enforce bidirectional tier consistency checks in manifest validator

  The verifiability schema now rejects all 4 invalid tier/field combinations:

  - `hardware-attested` requires `tee` or `e2ee` execution
  - `hardware-attested` requires an `attestation` field
  - `self-attested` cannot use `tee` or `e2ee` execution
  - `self-attested` cannot include an `attestation` field

### Patch Changes

- 4fbcb98: access.links values now require valid HTTPS URLs; non-HTTPS values (onchain addresses, http://, ipfs://) are rejected by schema validation.
- 5e3c7fb: Enforce ERC-spec parser caps on `access.requirements`: max 256 entries, max 4,096 decoded bytes per `access[].data` field.
- 0032316: Enforce access label limit as 256 bytes (UTF-8) instead of 256 characters, aligning with the updated ERC spec.
- e7286be: Enforce lowercase-only hex in manifest schema fields (`access[].kind`, `access[].data`, `attestation.enclaveHash`, `reproducibleBuild.buildHash`, `creatorAddress`) to match the tightened ERC spec. Normalize wallet and onchain addresses to lowercase before comparison in `register` and `update-metadata` commands.

## 0.4.2

### Patch Changes

- Updated dependencies [9ecf704]
  - @opensea/wallet-adapters@0.3.0

## 0.4.1

### Patch Changes

- 5ea8a05: Replace ERC-XXXX placeholder references with ERC-Draft throughout CLI help text, schema defaults, and documentation.

## 0.4.0

### Minor Changes

- 5838915: DX improvements from canary builder feedback:

  - `createWellKnownHandler` now accepts `ManifestDefinition` (with `EnvResolver` lambdas) and resolves internally on first request — eliminates the silent-failure footgun where lambda fields would serialize as `undefined`. Accepts an optional `env` parameter for non-Node runtimes (Cloudflare Workers, Bun).
  - Well-known handler no longer 404s on pathname mismatch — relies on framework router. If you mounted `createWellKnownHandler` as a fall-through, scope it to the well-known path explicitly.
  - `defineToolPaywall` recipient accepts `EnvResolver<Address>` so the payout address can be read from env vars at request time instead of module-load time
  - `defineToolPaywall` returns `onSettle` callback for post-payment telemetry/logging
  - Template `package.json` files inject the current SDK version at `init` time instead of pinning stale `^0.1.0`
  - Vercel adapter uses `x-forwarded-proto` header (consistent with Express adapter)
  - `describeToolAccess` helper reads a tool's predicate name and requirements from the registry; `decodeRequirement` decodes known kinds (ERC-721, ERC-1155, Subscription) into typed objects
  - `onSettle` payer is now sourced from the facilitator's `/verify` response (reliable for pure-x402 tools) with fallback to `ctx.callerAddress`
  - `registerTool` and `updateToolMetadata` validate URI length client-side before sending the transaction
  - Templates include `EnvResolver` lambda examples in comments
  - `init` command prints workspace warning for pnpm users

- ba59886: Add `@opensea/tool-sdk/testing` subpath export with test utilities for tool builders: `createMockManifest`, `createMockToolContext`, `mockFetch`, and `createTestHandler`.

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

- 905ed4a: Initial release of `@opensea/tool-sdk` — SDK and CLI for building ERC-Draft compliant AI agent tools.

  ### Core SDK

  - `createToolHandler` for building tools with manifest validation, JCS keccak256 hashing, well-known endpoint middleware, and a `GateMiddleware` chain.
  - Framework adapters for Vercel, Cloudflare, and Express. Includes `VercelRequest`/`VercelResponse`/`ExpressRequest`/`ExpressResponse` type exports.
  - `ToolHandlerError` for typed HTTP status codes; unhandled errors are logged automatically.
  - `ToolManifestSchema` with optional `verifiability` block (tier, execution, dataRetention, sourceVisibility, attestation, reproducibleBuild).

  ### Onchain integration

  - `ToolRegistryClient` with `registerTool`, `setAccessPredicate`, `tryHasAccess`, and `listToolsByCreator`.
  - Canonical CREATE2 deployments on Base mainnet: `TOOL_REGISTRY` (v0.1), `ERC721_OWNER_PREDICATE`, `ERC1155_OWNER_PREDICATE`. Each is a `Deployment` object (`{ address, chains, overrides? }`); resolve per-chain with `deploymentAddress(deployment, chainId)`.
  - `register` CLI enforces `creatorAddress` matches the signing wallet per ERC-Draft spec.
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
