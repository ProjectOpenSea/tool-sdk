# tool-sdk — Agent Conventions

TypeScript SDK and CLI for building ERC-8257 compliant AI agent tools.

## Quick Reference

```bash
cd packages/tool-sdk
pnpm install
pnpm run build       # Build with tsup
pnpm run test        # Run tests with Vitest
pnpm run lint        # Lint with Biome
pnpm run format      # Format with Biome
pnpm run type-check  # TypeScript type checking
```

## Architecture

| Path | Role |
|------|------|
| `src/index.ts` | Library entry point — public `tool-sdk` exports |
| `src/cli.ts` | CLI bin entry — imports `program` and calls `program.parse()` |
| `src/cli/index.ts` | Commander program wiring — builds `program` and registers all commands |
| `src/types.ts` | Shared public types |
| `src/cli/commands/` | CLI commands: `auth`, `configure-erc20-gate`, `configure-subscription`, `configure-trait-gating`, `deploy`, `dry-run-gate`, `dry-run-predicate-gate`, `export`, `get-collections`, `get-erc20-config`, `get-trait-config`, `hash`, `init`, `inspect`, `pay`, `register`, `set-collection-tokens`, `set-collections`, `smoke`, `update-metadata`, `validate`, `verify` |
| `src/lib/onchain/abis.ts` | TypeScript ABI definitions mirroring Solidity interfaces |
| `src/lib/onchain/chains.ts` | Deployed contract addresses per chain |
| `src/lib/onchain/registry.ts` | `ToolRegistryClient` — onchain interaction wrapper |
| `src/lib/onchain/hash.ts` | JCS keccak256 manifest hashing |
| `src/lib/onchain/access.ts` | Access-check helpers for tool gating |
| `src/lib/onchain/predicate-clients.ts` | Typed clients for predicate contracts |
| `src/lib/manifest/` | Manifest schema, validation, types |
| `src/lib/handler/` | `createToolHandler` — Web Request/Response handler factory |
| `src/lib/middleware/` | Gating middleware (predicate gate, x402, x402 facilitators, well-known endpoint) |
| `src/lib/wallet/` | Re-exports from `@opensea/wallet-adapters` (adapters, types, and viem bridge) |
| `src/lib/client/` | Authenticated HTTP clients: EIP-3009 auth, SIWE auth, x402 payment, external signer, paid authenticated fetch |
| `src/lib/usage/` | Usage reporters — report tool invocations / x402 settlements to the OpenSea usage endpoint, plus EIP-3009 zero-value auth helpers |
| `src/lib/adapters/` | Framework adapters (Vercel, Cloudflare, Express) |
| `src/lib/utils.ts` | Shared utilities used across `lib/` |
| `src/templates/` | Scaffolding templates for `init` command |
| `src/testing/` | Test helpers exported via `@opensea/tool-sdk/testing` subpath |
| `src/__tests__/` | Vitest test suite |
| `skill/SKILL.md` | Co-located copy of the opensea-tool-sdk skill (public-facing agent playbook) |
| `skill/references/` | Reference docs for the skill (x402, predicate gating, known predicates) |

## Review Checklist

When reviewing changes to this package, verify:

1. **ABI completeness**: `abis.ts` must include every function and event from the corresponding Solidity interfaces in `../tool-registry/src/interfaces/`. If the Solidity interface adds a function, `abis.ts` must add it too. Missing ABI entries mean SDK consumers cannot call those functions.

2. **Address & supported-chain sync**: Addresses in `chains.ts` must match `../tool-registry/README.md`. After a new deploy, both files must be updated together. Also update `skill/SKILL.md` and `skill/references/known-predicates.md` — they hardcode contract addresses.

   When a deploy adds a **new chain** (not just a new address), the chain ID must be added to *every* `Deployment.chains` array in `chains.ts` **and** to every prose location that enumerates supported chains — these are easy to miss because they're not address strings. Grep for the current chain list (e.g. `"Ethereum mainnet"`, `"mainnet + Base"`, `"mainnet and Base"`) across docs and fix each:
   - `skill/SKILL.md` "Deployed Contracts (…)" heading + the "identical CREATE2 address on …" line
   - `skill/references/known-predicates.md` intro line + each predicate's "Canonical deployment: … (…)" note
   - `docs/predicate-gating-guide.md` (standalone — not part of the skill copies)
   - `../tool-registry/README.md` live-addresses table "Chains" column, `foundry.toml` (`[rpc_endpoints]` + `[etherscan]`), and `.env.example`
   Only the six tool-registry deployments change; leave `DELEGATE_REGISTRY` and unrelated Base/mainnet references (swaps, wallet, marketplace examples) alone.

3. **Skill sync**: `skill/SKILL.md` and `skill/references/` are the single source of truth for agent-facing documentation. They hardcode requirement-type selectors (`kind` values from `IRequirementTypes.sol`), contract addresses, and CLI commands. When any of these change in `tool-registry`, update the skill files in the same PR:
   - Deployed addresses → "Deployed Contracts" table in `skill/SKILL.md` + address references in `skill/references/known-predicates.md`
   - `IRequirementTypes.sol` selectors → `kind` values in `skill/references/known-predicates.md`
   - New predicates in `../tool-registry/examples/` → new entry in `skill/references/known-predicates.md`
   - CLI commands added/removed in `src/cli/index.ts` → CLI commands table in Section 6 of `skill/SKILL.md`
   - The `skill/` copy must also be mirrored to `../skill/opensea-tool-sdk/` (the canonical skill location)

4. **Dead code after refactors**: When removing features (e.g., dropping a predicate factory), verify that all related imports, constants, and references are also removed. Check for unused imports at the top of refactored files.

5. **CLI error messages**: Error messages shown to SDK consumers should not reference internal file paths (e.g., "Update chains.ts"). Link to the README or provide actionable instructions instead.

6. **Multi-step CLI flows**: Commands that require multiple onchain transactions must handle partial failure gracefully — print recovery instructions if a subsequent TX fails.

7. **`--dry-run` accuracy**: Dry-run output must reflect the full onchain footprint. If the command sends multiple transactions, the dry-run should mention all of them.

8. **Predicate CLIs default to the canonical address**: Any CLI command that targets a predicate contract must resolve the address from `chains.ts` (via `deploymentAddress(<PREDICATE>, chain.id)`) by default, and expose `--predicate-address` only as an *optional override* — never a `requiredOption`. Forcing users to pass `--predicate-address` for a predicate that has a canonical deployment is a recurring papercut. See `configure-erc20-gate.ts` / `get-erc20-config.ts` for the reference shape (and `configure-trait-gating.ts` / `get-trait-config.ts` from #353).

   New-predicate lifecycle:
   1. Land the predicate + CLI with a zero-address stub in `chains.ts`. The CLI's `deploymentAddress(...)` returns `undefined`, so it errors with `"…has no canonical deployment on <network>. Pass --predicate-address."` — i.e. the override is required only until a real deploy exists.
   2. After deploying, replace the stub with the real address + `chains: [...]` in `chains.ts` and the README (see checklist item 2). No CLI code change is needed — the default starts resolving automatically.

## Conventions

- ESM-only (`"type": "module"`). Use `.js` extensions in import paths.
- Biome for linting and formatting: double quotes, 2-space indent, trailing commas.
- `as const` on all ABI definitions for type narrowing with viem.
- CLI commands use Commander.js. Wallet is configured via `--wallet-provider` flag or env vars (see `.env.example`).
- `ToolRegistryClient` wraps viem `PublicClient` and `WalletClient` — all onchain reads/writes go through it.
