# tool-sdk — Agent Conventions

TypeScript SDK and CLI for building ERC-XXXX compliant AI agent tools.

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
| `src/cli.ts` | CLI entry point (Commander program wiring) |
| `src/types.ts` | Shared public types |
| `src/cli/commands/` | CLI commands: `register`, `validate`, `verify`, `hash`, `init` |
| `src/lib/onchain/abis.ts` | TypeScript ABI definitions mirroring Solidity interfaces |
| `src/lib/onchain/chains.ts` | Deployed contract addresses per chain |
| `src/lib/onchain/registry.ts` | `ToolRegistryClient` — onchain interaction wrapper |
| `src/lib/onchain/hash.ts` | JCS keccak256 manifest hashing |
| `src/lib/manifest/` | Manifest schema, validation, types |
| `src/lib/handler/` | `createToolHandler` — Web Request/Response handler factory |
| `src/lib/middleware/` | Gating middleware (NFT gate, x402, well-known endpoint) |
| `src/lib/wallet/` | Re-exports from `@opensea/wallet-adapters` (adapters, types, and viem bridge) |
| `src/lib/adapters/` | Framework adapters (Vercel, Cloudflare, Express) |
| `src/lib/utils.ts` | Shared utilities used across `lib/` |
| `src/templates/` | Scaffolding templates for `init` command |
| `src/__tests__/` | Vitest test suite |

## Review Checklist

When reviewing changes to this package, verify:

1. **ABI completeness**: `abis.ts` must include every function and event from the corresponding Solidity interfaces in `../tool-registry/src/interfaces/`. If the Solidity interface adds a function, `abis.ts` must add it too. Missing ABI entries mean SDK consumers cannot call those functions.

2. **Address sync**: Addresses in `chains.ts` must match `../tool-registry/README.md`. After a new deploy, both files must be updated together.

3. **Dead code after refactors**: When removing features (e.g., dropping a predicate factory), verify that all related imports, constants, and references are also removed. Check for unused imports at the top of refactored files.

4. **CLI error messages**: Error messages shown to SDK consumers should not reference internal file paths (e.g., "Update chains.ts"). Link to the README or provide actionable instructions instead.

5. **Multi-step CLI flows**: Commands that require multiple onchain transactions (e.g., `register --nft-gate` does `registerTool` then `setCollections`) must handle partial failure gracefully — print recovery instructions if the second TX fails.

6. **`--dry-run` accuracy**: Dry-run output must reflect the full onchain footprint. If the command sends multiple transactions, the dry-run should mention all of them.

## Conventions

- ESM-only (`"type": "module"`). Use `.js` extensions in import paths.
- Biome for linting and formatting: double quotes, 2-space indent, trailing commas.
- `as const` on all ABI definitions for type narrowing with viem.
- CLI commands use Commander.js. Wallet is configured via `--wallet-provider` flag or env vars (see `.env.example`).
- `ToolRegistryClient` wraps viem `PublicClient` and `WalletClient` — all onchain reads/writes go through it.
