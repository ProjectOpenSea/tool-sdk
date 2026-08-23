# tool-sdk — Agent Conventions

TypeScript SDK and CLI for building ERC-8257 compliant AI agent tools.

## Quick commands

```bash
cd packages/tool-sdk
pnpm run build
pnpm run test
pnpm run lint
pnpm run type-check
```

## Responsibilities

- Library: manifest validation, onchain registry client, gating middleware, x402 payment gates and facilitators, usage reporting, framework adapters, wallet re-exports.
- CLI: register, gate, inspect, pay, and smoke-test tools.
- Skill docs (`skill/`) mirror the agent-facing playbook at `packages/skill/opensea-tool-sdk/`.

## Rules

1. **ABI ↔ Solidity interface sync**. Every function/event in `packages/tool-registry/src/interfaces/*.sol` must have a matching entry in `src/lib/onchain/abis.ts`. CI enforces this with `packages/tool-registry/scripts/check-abi-sync.sh` (run `forge build` in tool-registry first).
2. **Address & chain sync**. Deployed addresses and supported chains in `src/lib/onchain/chains.ts` must match `packages/tool-registry/README.md`. Update the `skill/` copies in the same PR.
3. **Skill sync**. `packages/tool-sdk/skill/` and `packages/skill/opensea-tool-sdk/` are identical copies. CI enforces this with `scripts/check-skill-sync.sh`. Update both when contract addresses, interface IDs (`IRequirementTypes.sol` selectors), predicates, or CLI commands change.
4. **Predicate CLI defaults**. CLI commands targeting predicates resolve the canonical address from `chains.ts` by default; `--predicate-address` is only an optional override.
5. **Multi-step flows**. Commands that send multiple onchain transactions must print recovery instructions if an intermediate TX fails and must show the full footprint in `--dry-run`.
6. **User-facing errors**. Error messages must not reference internal file paths (e.g. "Update chains.ts"); link to README/docs or give actionable instructions.
7. **Dead code**. When removing features, clean up related imports, constants, and references.

## Conventions

- ESM-only, `.js` import extensions.
- `as const` on all ABI definitions.
- Commander.js for CLI; wallet via `--wallet-provider` or env vars.
- `ToolRegistryClient` wraps viem clients.
