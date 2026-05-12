# Consumer-Side Attestation Verification — Design Proposal

> **Status:** Draft proposal  
> **Package:** `@opensea/tool-sdk`  
> **ERC reference:** `packages/tool-registry/eip-draft-tool-registry.md` (Section 5 — Verifiability)  
> **Date:** 2026-05-07

## Summary

The ERC spec defines three verifiability tiers — `"self-attested"`, `"hardware-attested"`, and `"verifiable"` — but the tool-sdk today only validates the manifest schema. This document proposes a `verifyAttestation()` consumer-side API that lets agents cryptographically verify a tool's verifiability claims before invocation.

---

## 1. Attestation Protocol Landscape

### 1.1 Protocols in Scope

The spec's `attestation.type` field is an opaque string. The three protocols most likely to appear in practice are:

| Protocol | Platform | Measurement field | Report format | Quote size |
|---|---|---|---|---|
| **DCAP v3** | Intel SGX / Intel TDX | `MRENCLAVE` (SGX) or `MRTD` + `RTMR` (TDX) | SGX Quote v3 (binary, ASN.1 cert chain) | ~4-6 KB |
| **Nitro** | AWS Nitro Enclaves | `PCR0` (enclave image), `PCR1` (kernel), `PCR2` (app) | CBOR-encoded COSE_Sign1 (NSM attestation document) | ~3-5 KB |
| **SEV-SNP** | AMD EPYC | `MEASUREMENT` (launch digest) | Binary report + VCEK cert chain | ~2-4 KB |

TDX attestation uses the same DCAP v3 quote format as SGX (the quote header distinguishes TEE type), so a DCAP v3 verifier handles both SGX and TDX.

### 1.2 JS/TS Libraries

| Library | Protocols | Runtime | Maturity | Notes |
|---|---|---|---|---|
| [`@phala/dcap-qvl`](https://npm.im/@phala/dcap-qvl) | DCAP v3 (SGX + TDX) | Node + browser (pure JS) | 12 versions, actively maintained by Phala Network | Pure JS port of Intel's QVL. Verifies quote signature, cert chain, TCB status. Isomorphic (works in browser). |
| [`@xnetx/sgx-ra-tls-verify`](https://npm.im/@xnetx/sgx-ra-tls-verify) | DCAP v3 (SGX) + RA-TLS | Node + browser (pure JS) | v0.0.1 (2026-04-19), very new | Verifies SGX DCAP quotes and RA-TLS certificates. Extracts MRENCLAVE/MRSIGNER. Designed for Gramine-based enclaves. |
| [`secretvm-verify`](https://npm.im/secretvm-verify) | TDX, SEV-SNP, NVIDIA GPU | Node (depends on ethers) | 23 versions, actively maintained by Secret Network | Multi-platform verifier. Wraps `@phala/dcap-qvl` for TDX. Has SEV-SNP and NVIDIA GPU support. |
| [`@cardinal-cryptography/enclaves`](https://npm.im/@cardinal-cryptography/enclaves) | AWS Nitro | Node + browser | v0.3.0, maintained | Nitro attestation document verification. CBOR/COSE parsing, cert chain validation against AWS Nitro root CA. |
| [`@dashlane/nsm-attestation`](https://npm.im/@dashlane/nsm-attestation) | AWS Nitro | Node | v1.0.2, stable | Nitro NSM attestation parsing/verification. Uses `cbor` + `cose-js`. Battle-tested at Dashlane. |
| [`@automata-network/automata-dcap-attestation`](https://npm.im/@automata-network/automata-dcap-attestation) | DCAP v3 | EVM (onchain) | v1.1.0 | Solidity contracts for onchain DCAP quote verification. Useful as a reference but not directly usable in a JS client — relevant for hybrid onchain/offchain verification. |

### 1.3 Unified Verification Services

| Service | Model | Protocols |
|---|---|---|
| **Automata DCAP Attestation** | Onchain Solidity contracts deployed on multiple EVM chains. Verifies DCAP v3 quotes onchain. Useful for trustless verification but gas-intensive (~2-5M gas). | DCAP v3 (SGX + TDX) |
| **Phala Network** | Provides `@phala/dcap-qvl` for offchain verification. Also runs TEE-based coprocessors that can verify attestation as part of their execution. | DCAP v3 |
| **Gramine / RA-TLS** | Framework for running unmodified apps in SGX enclaves. RA-TLS embeds the attestation quote in a TLS certificate's X.509 extension. Verification is done at TLS handshake time. The `@xnetx/sgx-ra-tls-verify` library extracts and verifies these. | DCAP v3 (SGX only) |
| **Sigstore Rekor** | Append-only transparency log. Not a verifier itself, but the spec's `transparencyLogURI` field points here. The `@sigstore/rekor-types` package provides TypeScript types for the Rekor API. The `sigstore` npm package provides full verification (inclusion proof, signed tree head). | Protocol-agnostic (logs any attestation) |

### 1.4 Key Takeaway

There is no single unified JS library that verifies all three protocols. The closest is `secretvm-verify` (TDX + SEV-SNP), but it does not cover Nitro. A pluggable provider architecture is necessary.

---

## 2. `maxAge` Freshness Check

### 2.1 Feasibility

A provider-agnostic freshness check is **tractable** because every attestation protocol embeds a timestamp or nonce in its report, and the manifest schema already defines `attestation.maxAge` (seconds).

### 2.2 Expected Response Format

The spec does not define a response format for `attestation.endpoint`. We propose the following convention (non-normative, recommended):

```
GET <attestation.endpoint>
Accept: application/octet-stream   (raw report bytes)
   -or-
Accept: application/json           (structured envelope)
```

**JSON envelope (recommended):**
```json
{
  "type": "dcap-v3",
  "report": "<base64-encoded raw attestation report>",
  "certificates": ["<PEM cert 1>", "..."],
  "timestamp": 1715100000
}
```

**Raw binary:** The endpoint returns the raw attestation report bytes (e.g., SGX Quote v3 binary, COSE_Sign1 CBOR bytes) with `Content-Type: application/octet-stream`.

### 2.3 Timestamp Extraction by Protocol

| Protocol | Timestamp source | Extraction method |
|---|---|---|
| DCAP v3 (SGX/TDX) | The quote itself has no timestamp, but the **QE (Quoting Enclave) certification data** contains an X.509 certificate chain with `notBefore`/`notAfter`. The freshness signal comes from the collateral (TCB info, CRL) which the verifier checks against Intel's PCS. Most practical: the endpoint includes a `timestamp` field in the JSON envelope, or the consumer uses the report-fetch time as the baseline. | Parse cert chain validity, or use envelope `timestamp` |
| Nitro | The NSM attestation document contains a `timestamp` field (milliseconds since epoch) in the CBOR payload. | Decode CBOR → read `timestamp` field |
| SEV-SNP | The attestation report contains a `REPORT_DATA` field (64 bytes) that can embed a nonce/timestamp, and the VCEK certificate has validity dates. The report structure itself includes a `VERSION` and platform-specific fields but no standardized timestamp. | Parse VCEK cert `notBefore`, or extract nonce from `REPORT_DATA` |

### 2.4 Provider-Agnostic Freshness Strategy

1. If the JSON envelope includes a `timestamp` field, use it as the report time.
2. If the raw report is returned, delegate to the provider-specific parser to extract the timestamp.
3. Fall back to the fetch time (`Date.now()`) as an upper bound — the report cannot be newer than when we received it, but it could be older.
4. Compare: `if (Date.now() / 1000 - reportTimestamp > maxAge) → stale`.

The `maxAge` check itself is trivial; the complexity is in extracting the timestamp, which is provider-specific. This is another argument for the pluggable provider architecture.

---

## 3. `enclaveHash` Verification

### 3.1 Measurement Comparison

After parsing the attestation report, the consumer extracts the enclave measurement and compares it to `attestation.enclaveHash` from the manifest. This is a **byte comparison**, but the field to extract is provider-specific:

| Protocol | Measurement field | Size | Extraction |
|---|---|---|---|
| DCAP v3 (SGX) | `MRENCLAVE` at quote body offset 112 | 32 bytes | Parse SGX Quote v3 → Report Body → bytes [112..144] |
| DCAP v3 (TDX) | `MRTD` (TD measurement register) | 48 bytes | Parse TDX Quote → TD Report → MRTD field |
| Nitro | `PCR0` (enclave image measurement) | 48 bytes (SHA-384) | Decode CBOR → `pcrs` map → key `0` |
| SEV-SNP | `MEASUREMENT` (launch digest) | 48 bytes | Parse SNP report → bytes [144..192] |

### 3.2 Comparison Logic

```
reportHash = provider.extractMeasurement(parsedReport)
manifestHash = hexToBytes(manifest.verifiability.attestation.enclaveHash)
match = constantTimeEqual(reportHash, manifestHash)
```

The comparison is straightforward after parsing but **parsing is entirely provider-specific**. Each provider plugin must implement `extractMeasurement(report: Uint8Array): Uint8Array`.

### 3.3 Hash Length Mismatch

The manifest `enclaveHash` field is variable-length hex (`^0x([0-9a-f]{2})+$`). SGX uses 32-byte SHA-256 measurements; Nitro and SEV-SNP use 48-byte SHA-384. The comparison must check length equality first and reject on mismatch.

---

## 4. `reproducibleBuild` Verification

### 4.1 What Verification Looks Like

The `"verifiable"` tier requires the full chain: `source → binary → enclave measurement → attestation report`. Verifying `reproducibleBuild` means:

1. Clone the source at `reproducibleBuild.sourceCodeURI` (e.g., a Git commit URL).
2. Run `reproducibleBuild.buildInstructions` (e.g., `nix build .#enclave` or `docker build ...`).
3. Hash the output binary → compare to `reproducibleBuild.buildHash`.
4. Compare `buildHash` to `attestation.enclaveHash` to close the chain.

### 4.2 Is This a Runtime Client Operation?

**No.** Reproducible build verification is inherently an **offline/CI process**:

- It requires cloning a Git repository, installing build toolchains (Nix, Docker, Gramine, etc.), and executing arbitrary build commands.
- Build times range from seconds to hours depending on the project.
- It requires trusting the build environment (a compromised build host defeats the purpose).
- It is not something an agent should block on before making an API call.

### 4.3 Practical Approach

| Actor | Responsibility |
|---|---|
| **CI/auditor** | Periodically runs the reproducible build, compares `buildHash` to the published `enclaveHash`, and publishes results (e.g., to the transparency log). |
| **Runtime client (`verifyAttestation`)** | Checks that `reproducibleBuild.buildHash === attestation.enclaveHash` (byte comparison). This does NOT verify the build itself — it only checks that the manifest claims are internally consistent. |
| **Indexer/registry** | Caches reproducible build verification results and surfaces them as a trust signal alongside the tool listing. |

The `verifyAttestation()` function should:
- Verify that `buildHash` is present when `tier === "verifiable"`.
- Compare `buildHash` to `enclaveHash` for internal consistency.
- **Not** attempt to execute `buildInstructions`.

For deeper verification, a separate `verifyReproducibleBuild()` utility (or CI integration) could be provided in the future — but that is out of scope for the runtime SDK.

---

## 5. Proposed API Shape

### 5.1 Core Function

```typescript
import type { ToolManifest, Attestation, Verifiability } from "@opensea/tool-sdk"

/**
 * Result of attestation verification. Uses a result type (not exceptions)
 * so callers can make graduated trust decisions.
 */
interface AttestationVerificationResult {
  /** Whether all requested checks passed. */
  verified: boolean

  /** The effective trust tier after verification.
   *  May be lower than manifest.verifiability.tier if checks failed. */
  effectiveTier: "self-attested" | "hardware-attested" | "verifiable"

  /** Per-check results for fine-grained inspection. */
  checks: {
    /** Manifest schema consistency (tier vs. fields present). Always run. */
    consistency: CheckResult

    /** Attestation report freshness (maxAge). Skipped for self-attested. */
    freshness?: CheckResult

    /** Enclave measurement matches manifest.attestation.enclaveHash. */
    enclaveHash?: CheckResult

    /** Attestation report cryptographic verification (cert chain, signature). */
    reportSignature?: CheckResult

    /** reproducibleBuild.buildHash === attestation.enclaveHash. */
    buildConsistency?: CheckResult

    /** Transparency log inclusion (if transparencyLogURI present). */
    transparencyLog?: CheckResult
  }

  /** Raw parsed attestation report, if fetched and parsed successfully. */
  report?: ParsedAttestationReport
}

interface CheckResult {
  passed: boolean
  /** Human-readable detail on failure. */
  reason?: string
}

interface ParsedAttestationReport {
  /** Provider that parsed this report. */
  provider: string
  /** Extracted enclave measurement (hex-encoded). */
  measurement?: string
  /** Report timestamp (Unix seconds), if available. */
  timestamp?: number
  /** Raw report bytes. */
  raw: Uint8Array
}

interface VerifyAttestationOptions {
  /**
   * Override the attestation endpoint URL.
   * Default: manifest.verifiability.attestation.endpoint
   */
  attestationEndpoint?: string

  /**
   * Override maxAge (seconds). If not set, uses manifest value,
   * then falls back to 3600 (1 hour).
   */
  maxAge?: number

  /**
   * Custom fetch implementation (for testing or environments
   * without global fetch).
   */
  fetch?: typeof globalThis.fetch

  /**
   * Pluggable attestation providers. If not supplied, uses the
   * built-in provider registry.
   */
  providers?: AttestationProvider[]

  /**
   * Skip fetching the attestation report and only run local checks
   * (consistency, buildConsistency). Useful when the report was
   * already fetched and cached.
   */
  reportBytes?: Uint8Array

  /**
   * Abort signal for the fetch request.
   */
  signal?: AbortSignal
}

/**
 * Verify a tool manifest's verifiability claims.
 *
 * For "self-attested" tools, only runs consistency checks.
 * For "hardware-attested" and "verifiable" tools, fetches the
 * attestation report and verifies it cryptographically.
 *
 * Returns a result object — does NOT throw on verification failure.
 * Throws only on unrecoverable errors (network failure, malformed
 * response, no provider for the attestation type).
 */
declare function verifyAttestation(
  manifest: ToolManifest,
  options?: VerifyAttestationOptions,
): Promise<AttestationVerificationResult>
```

### 5.2 Provider Plugin Interface

```typescript
/**
 * Plugin interface for attestation protocol-specific verification.
 * Each provider handles one attestation.type value.
 */
interface AttestationProvider {
  /** The attestation.type values this provider handles (e.g., ["dcap-v3"]). */
  readonly supportedTypes: readonly string[]

  /**
   * Parse a raw attestation report and verify its cryptographic integrity
   * (signature chain, cert validation, TCB status).
   *
   * @returns Parsed report with extracted measurement and timestamp.
   * @throws On cryptographic verification failure.
   */
  verifyReport(
    reportBytes: Uint8Array,
    options?: ProviderVerifyOptions,
  ): Promise<ParsedAttestationReport>
}

interface ProviderVerifyOptions {
  /**
   * For providers that need to fetch collateral (e.g., Intel PCS for
   * TCB info, CRL). Pass a custom fetch if needed.
   */
  fetch?: typeof globalThis.fetch

  /** Abort signal. */
  signal?: AbortSignal
}
```

### 5.3 Built-in Providers (Future)

```typescript
// Phase 2 — shipped as separate entrypoints to keep the core bundle lean
import { DcapV3Provider } from "@opensea/tool-sdk/providers/dcap-v3"
import { NitroProvider } from "@opensea/tool-sdk/providers/nitro"
import { SevSnpProvider } from "@opensea/tool-sdk/providers/sev-snp"

const result = await verifyAttestation(manifest, {
  providers: [new DcapV3Provider(), new NitroProvider()],
})
```

### 5.4 Why Result Type, Not Throw

Attestation verification has **graduated outcomes**:
- A stale report (maxAge exceeded) is less severe than a signature failure.
- A missing `transparencyLogURI` is informational, not fatal.
- An agent framework may want to invoke a tool with a degraded trust tier (e.g., allow `hardware-attested` even if the build consistency check fails).

Throwing on any failure would force callers into try/catch and lose the granularity. The result type lets agents implement their own trust policies:

```typescript
const result = await verifyAttestation(manifest)

if (result.effectiveTier === "self-attested" && manifest.verifiability?.tier === "verifiable") {
  // Tool claims verifiable but couldn't prove it — flag to user
  agent.warn(`Tool ${manifest.name} claims verifiable tier but verification degraded to self-attested`)
}

if (!result.checks.freshness?.passed) {
  // Stale attestation — may still be acceptable for low-risk operations
  agent.log(`Attestation for ${manifest.name} is stale (${result.checks.freshness?.reason})`)
}
```

The function **does** throw for truly unrecoverable errors: network failure when fetching the report, malformed/unparseable response, or no registered provider for the `attestation.type`. These are not verification failures — they are operational errors that prevent verification from running at all.

---

## 6. Phasing Recommendation

### Phase 1 — Ship First (Low Complexity, High Value)

**Scope:** Consistency checks + maxAge freshness + enclaveHash comparison

| Check | Implementation effort | Dependencies |
|---|---|---|
| **Manifest consistency** | Trivial — already partially done in `VerifiabilitySchema.superRefine()`. Extend to check `verifiable` tier requires both `attestation` and `reproducibleBuild`. | None (pure logic) |
| **Attestation endpoint fetch** | Low — HTTP GET with timeout, `Content-Type` negotiation. | `fetch` (built-in) |
| **maxAge freshness** | Low — parse envelope `timestamp` or use fetch time as fallback. | None |
| **enclaveHash comparison** | Low — extract measurement from parsed report, byte-compare. Requires provider to have parsed the report. | Provider plugin |
| **buildConsistency** | Trivial — compare two hex strings from the manifest. | None |
| **Provider plugin interface** | Medium — define the `AttestationProvider` interface and registry. Ship with **zero** built-in providers initially; the interface is the deliverable. | None |
| **`verifyAttestation()` orchestrator** | Medium — wire together the checks, fetch, provider dispatch. | Above pieces |

**Phase 1 does NOT include built-in provider implementations.** The plugin interface ships, and consumers bring their own provider (e.g., wrapping `@phala/dcap-qvl`). This lets us ship the API without taking a dependency on any specific attestation library.

**Estimated effort:** 1-2 weeks for one engineer.

### Phase 2 — Built-in DCAP v3 Provider

**Scope:** Ship a `DcapV3Provider` that wraps `@phala/dcap-qvl`.

| Task | Effort | Notes |
|---|---|---|
| Wrap `@phala/dcap-qvl` in `AttestationProvider` interface | Medium | Parse SGX/TDX quotes, extract MRENCLAVE/MRTD, verify cert chain |
| TCB collateral fetching | Medium | May need Intel PCS API calls for fresh collateral. `@phala/dcap-qvl` handles this internally but needs network access. |
| Test against real SGX/TDX quotes | High | Need access to a TEE environment or use Phala's test vectors |

**Estimated effort:** 2-3 weeks.

**Dependency:** `@phala/dcap-qvl` (Apache-2.0, 124 KB unpacked, 8 deps). This is the strongest candidate — it's pure JS, isomorphic, and actively maintained. It handles the full DCAP v3 verification pipeline including TCB status.

### Phase 3 — Built-in Nitro Provider

**Scope:** Ship a `NitroProvider` that wraps `@cardinal-cryptography/enclaves` or `@dashlane/nsm-attestation`.

| Task | Effort | Notes |
|---|---|---|
| CBOR/COSE_Sign1 parsing | Medium | Nitro attestation documents are CBOR-encoded COSE_Sign1 structures |
| AWS Nitro root CA certificate pinning | Low | The root CA cert is published by AWS and rarely changes |
| PCR extraction and comparison | Low | PCR0 = enclave image hash, straightforward extraction from CBOR map |

**Estimated effort:** 2 weeks.

**Library candidates:**
- `@cardinal-cryptography/enclaves` (Apache-2.0, 37.5 KB) — Lighter, actively maintained.
- `@dashlane/nsm-attestation` (proprietary license, 55.3 KB) — Battle-tested at Dashlane but proprietary license is a concern.

**Recommendation:** Use `@cardinal-cryptography/enclaves` for the open-source license.

### Phase 4 — Transparency Log Verification

**Scope:** Verify that the attestation report appears in the Sigstore Rekor transparency log.

| Task | Effort | Notes |
|---|---|---|
| Fetch Rekor log entry from `transparencyLogURI` | Low | HTTP GET, parse JSON |
| Verify inclusion proof (Merkle tree) | Medium | The `sigstore` npm package provides this. Need to verify the signed tree head against Sigstore's root keys. |
| Compare log entry body to fetched attestation report | Medium | Need to define what exactly gets logged — the raw report bytes? A hash? |

**Estimated effort:** 2 weeks.

**Open question:** The spec does not define what format the transparency log entry should take. This needs to be specified before implementation.

### Phase 5 — SEV-SNP Provider + Reproducible Build CI Tooling

**Scope:** SEV-SNP provider (wrapping `secretvm-verify`) and a CLI command for running reproducible build verification in CI.

This is the lowest priority because:
- SEV-SNP is less common in the current AI tool ecosystem than SGX/Nitro.
- Reproducible build verification is an offline/CI concern, not a runtime SDK concern.

### Summary Table

| Phase | Deliverable | Effort | Dependencies added |
|---|---|---|---|
| **1** | `verifyAttestation()` orchestrator + plugin interface + consistency/freshness/hash checks | 1-2 weeks | None |
| **2** | `DcapV3Provider` (SGX + TDX) | 2-3 weeks | `@phala/dcap-qvl` |
| **3** | `NitroProvider` (AWS Nitro) | 2 weeks | `@cardinal-cryptography/enclaves` |
| **4** | Transparency log verification | 2 weeks | `sigstore` |
| **5** | `SevSnpProvider` + reproducible build CLI | 3+ weeks | `secretvm-verify` |

---

## 7. Blockers and Open Questions

### Must Resolve Before Phase 1

1. **Attestation endpoint response format.** The spec says `attestation.endpoint` returns a "fresh remote attestation report" but does not specify the HTTP response format. We need to either:
   - Define a recommended JSON envelope format (as proposed in Section 2.2).
   - Accept raw binary with `Content-Type` negotiation.
   - Or both (try JSON first, fall back to binary).

   **Recommendation:** Support both, with JSON envelope preferred. Document the recommended format in the spec or in tool-sdk docs.

2. **Where to export from.** Should `verifyAttestation` be a top-level export from `@opensea/tool-sdk`, or a separate entrypoint (`@opensea/tool-sdk/verify`)? Top-level is simpler for consumers but increases the minimum bundle for tools that only use the server-side SDK.

   **Recommendation:** Separate entrypoint (`@opensea/tool-sdk/verify`) to keep the server-side bundle lean. Providers ship as `@opensea/tool-sdk/providers/dcap-v3`, etc.

### Must Resolve Before Phase 2

3. **TCB collateral freshness.** DCAP v3 verification requires Intel PCS (Provisioning Certification Service) collateral (TCB info, QE identity, CRLs). `@phala/dcap-qvl` can fetch this automatically, but it means the verification step makes additional HTTP calls to Intel's servers. Should we:
   - Let the provider fetch collateral on demand? (simpler, adds latency)
   - Accept pre-fetched collateral in `ProviderVerifyOptions`? (more flexible, CI-friendly)
   - Cache collateral with a TTL? (fastest for repeated verifications)

   **Recommendation:** All three. Fetch on demand by default, accept pre-fetched via options, cache with a configurable TTL (default: 24 hours, matching Intel's CRL update cadence).

4. **TCB status interpretation.** DCAP v3 reports include a TCB status (`UpToDate`, `SWHardeningNeeded`, `ConfigurationNeeded`, `OutOfDate`, `Revoked`). What should `verifyAttestation` do with non-`UpToDate` statuses?

   **Recommendation:** Include `tcbStatus` in `ParsedAttestationReport` and let the caller decide. Only `Revoked` should cause `reportSignature.passed = false`. Other statuses are informational — the report is still cryptographically valid, it just indicates the platform firmware may need updates.

### Open Questions for the Team

5. **Onchain vs. offchain verification.** Automata provides onchain DCAP v3 verification contracts. Should we support a mode where `verifyAttestation` submits the quote to an onchain verifier and checks the result? This would give trustless verification but at significant gas cost.

   **Recommendation:** Defer to Phase 5+. The primary use case is agents running offchain making pre-invocation trust decisions. Onchain verification is relevant for smart contract wallets that want to gate tool invocation onchain, which is a different integration surface.

6. **RA-TLS integration.** Gramine-based enclaves can embed the attestation quote in a TLS certificate. If a tool uses RA-TLS, verification happens at TLS handshake time — no separate `attestation.endpoint` is needed. Should `verifyAttestation` support RA-TLS?

   **Recommendation:** Not in the initial phases. RA-TLS verification requires intercepting the TLS handshake, which is a fundamentally different flow from fetching a report from an HTTP endpoint. Document it as a future extension. Tools using RA-TLS can set `attestation.type: "ra-tls"` and a future provider can handle it.

7. **Caching policy.** Should `verifyAttestation` cache results? The spec says agents should verify before invocation, but re-fetching and re-verifying on every call adds latency.

   **Recommendation:** The function itself should be stateless (no internal cache). The caller (agent framework) is responsible for caching. Provide a `maxAge`-aware cache helper as a utility:

   ```typescript
   const cache = createAttestationCache({ defaultMaxAge: 3600 })
   const result = await cache.verify(manifest) // fetches only if stale
   ```
