import { describe, expect, it } from "vitest"
import { validateManifest } from "../lib/manifest/index.js"
import { defineVerifiability } from "../lib/manifest/verifiability.js"

const baseManifest = {
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}

describe("defineVerifiability", () => {
  describe("selfAttested", () => {
    it("should produce a valid self-attested verifiability block with defaults", () => {
      const result = defineVerifiability.selfAttested()
      expect(result.verifiability).toEqual({
        tier: "self-attested",
        execution: "standard",
      })
    })

    it("should accept dataRetention and sourceVisibility", () => {
      const result = defineVerifiability.selfAttested({
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
      })
      expect(result.verifiability.tier).toBe("self-attested")
      expect(result.verifiability.execution).toBe("standard")
      expect(result.verifiability.dataRetention).toBe("ephemeral")
      expect(result.verifiability.sourceVisibility).toBe("open-source")
    })

    it("should accept an optional description", () => {
      const result = defineVerifiability.selfAttested({
        description: "Standard execution, no TEE.",
      })
      expect(result.verifiability.description).toBe(
        "Standard execution, no TEE.",
      )
    })

    it("should ignore tier override attempts from JS callers", () => {
      const result = defineVerifiability.selfAttested({
        tier: "hardware-attested",
        execution: "tee",
      } as any)
      expect(result.verifiability.tier).toBe("self-attested")
      expect(result.verifiability.execution).toBe("standard")
    })

    it("should pass validateManifest when spread into a manifest", () => {
      const v = defineVerifiability.selfAttested({
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
      })
      const result = validateManifest({ ...baseManifest, ...v })
      expect(result.success).toBe(true)
    })
  })

  describe("hardwareAttested", () => {
    const attestation = {
      type: "nitro",
      endpoint: "https://enclave.example.com/.well-known/attestation",
      enclaveHash:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      maxAge: 300,
    }

    it("should produce a valid hardware-attested verifiability block", () => {
      const result = defineVerifiability.hardwareAttested({
        execution: "tee",
        attestation,
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
      })
      expect(result.verifiability.tier).toBe("hardware-attested")
      expect(result.verifiability.execution).toBe("tee")
      expect(result.verifiability.attestation?.type).toBe("nitro")
      expect(result.verifiability.attestation?.maxAge).toBe(300)
    })

    it("should accept e2ee execution", () => {
      const result = defineVerifiability.hardwareAttested({
        execution: "e2ee",
        attestation: { type: "dcap-v3" },
      })
      expect(result.verifiability.execution).toBe("e2ee")
    })

    it("should accept attestation with transparencyLogURI", () => {
      const result = defineVerifiability.hardwareAttested({
        execution: "tee",
        attestation: {
          ...attestation,
          transparencyLogURI:
            "https://rekor.sigstore.dev/api/v1/log/entries/abc123",
        },
      })
      expect(result.verifiability.attestation?.transparencyLogURI).toBe(
        "https://rekor.sigstore.dev/api/v1/log/entries/abc123",
      )
    })

    it("should throw on invalid attestation enclaveHash (uppercase)", () => {
      expect(() =>
        defineVerifiability.hardwareAttested({
          execution: "tee",
          attestation: {
            type: "dcap-v3",
            enclaveHash: "0xABCDEF",
          },
        }),
      ).toThrow("defineVerifiability")
    })

    it("should pass validateManifest when spread into a manifest", () => {
      const v = defineVerifiability.hardwareAttested({
        execution: "tee",
        attestation,
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
      })
      const result = validateManifest({ ...baseManifest, ...v })
      expect(result.success).toBe(true)
    })
  })

  describe("verifiable", () => {
    const attestation = {
      type: "nitro",
      endpoint: "https://enclave.example.com/.well-known/attestation",
      enclaveHash: "0xabcdef1234",
    }
    const reproducibleBuild = {
      sourceCodeURI: "https://github.com/example/tool/tree/abc123",
      buildInstructions: "docker build .",
      buildHash: "0xabcdef1234",
    }

    it("should produce a valid verifiable verifiability block", () => {
      const result = defineVerifiability.verifiable({
        execution: "tee",
        attestation,
        reproducibleBuild,
        dataRetention: "none",
        sourceVisibility: "open-source",
      })
      expect(result.verifiability.tier).toBe("verifiable")
      expect(result.verifiability.execution).toBe("tee")
      expect(result.verifiability.attestation?.type).toBe("nitro")
      expect(result.verifiability.reproducibleBuild?.sourceCodeURI).toBe(
        "https://github.com/example/tool/tree/abc123",
      )
    })

    it("should accept e2ee execution", () => {
      const result = defineVerifiability.verifiable({
        execution: "e2ee",
        attestation: { type: "dcap-v3" },
        reproducibleBuild: {
          sourceCodeURI: "https://github.com/example/tool",
        },
      })
      expect(result.verifiability.execution).toBe("e2ee")
    })

    it("should throw on invalid reproducibleBuild buildHash (uppercase)", () => {
      expect(() =>
        defineVerifiability.verifiable({
          execution: "tee",
          attestation: { type: "nitro" },
          reproducibleBuild: {
            sourceCodeURI: "https://github.com/example/tool",
            buildHash: "0xABCDEF",
          },
        }),
      ).toThrow("defineVerifiability")
    })

    it("should throw on http sourceCodeURI", () => {
      expect(() =>
        defineVerifiability.verifiable({
          execution: "tee",
          attestation: { type: "nitro" },
          reproducibleBuild: {
            sourceCodeURI: "http://insecure.example.com/repo",
          },
        }),
      ).toThrow("defineVerifiability")
    })

    it("should pass validateManifest when spread into a manifest", () => {
      const v = defineVerifiability.verifiable({
        execution: "tee",
        attestation,
        reproducibleBuild,
        dataRetention: "none",
        sourceVisibility: "open-source",
      })
      const result = validateManifest({ ...baseManifest, ...v })
      expect(result.success).toBe(true)
    })
  })

  describe("type-level constraints", () => {
    it("should return { verifiability } for spreading into defineManifest", () => {
      const v = defineVerifiability.selfAttested()
      expect(v).toHaveProperty("verifiability")
      expect(Object.keys(v)).toEqual(["verifiability"])
    })

    it("should produce output that composes with a full manifest", () => {
      const v = defineVerifiability.verifiable({
        execution: "tee",
        attestation: {
          type: "nitro",
          endpoint: "https://enclave.example.com/.well-known/attestation",
          enclaveHash: "0xabcdef1234",
        },
        reproducibleBuild: {
          sourceCodeURI: "https://github.com/example/tool/tree/abc123",
          buildInstructions: "nix build .#enclave",
          buildHash: "0xabcdef1234",
        },
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
      })
      const manifest = { ...baseManifest, ...v }
      const result = validateManifest(manifest)
      expect(result.success).toBe(true)
      if (!result.success) throw new Error("expected success")
      expect(result.data.verifiability?.tier).toBe("verifiable")
      expect(result.data.verifiability?.reproducibleBuild?.buildHash).toBe(
        "0xabcdef1234",
      )
    })
  })
})
