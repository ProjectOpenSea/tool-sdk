import { describe, expect, it } from "vitest"
import type { ManifestDefinition } from "../lib/manifest/index.js"
import {
  defineManifest,
  resolveManifest,
  validateManifest,
} from "../lib/manifest/index.js"

const validManifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "nft-price-oracle",
  description: "Returns estimated floor price for any NFT collection.",
  endpoint: "https://tools.example.com/nft-price-oracle",
  inputs: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        description: "Contract address",
      },
      chainId: { type: "integer" },
    },
    required: ["collection", "chainId"],
  },
  outputs: {
    type: "object",
    properties: {
      floorPriceEth: { type: "string" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  version: "1.0.0",
  tags: ["nft", "pricing", "oracle"],
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}

describe("validateManifest", () => {
  it("should validate a correct manifest", () => {
    const result = validateManifest(validManifest)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.name).toBe("nft-price-oracle")
  })

  it("should reject manifest with missing name", () => {
    const { name, ...noName } = validManifest
    const result = validateManifest(noName)
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toBeDefined()
  })

  it("should reject manifest with empty name", () => {
    const result = validateManifest({
      ...validManifest,
      name: "",
    })
    expect(result.success).toBe(false)
  })

  it("should reject manifest with name exceeding 128 chars", () => {
    const result = validateManifest({
      ...validManifest,
      name: "a".repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it("should reject manifest with description exceeding 500 chars", () => {
    const result = validateManifest({
      ...validManifest,
      description: "a".repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it("should reject http endpoint", () => {
    const result = validateManifest({
      ...validManifest,
      endpoint: "http://insecure.com/tool",
    })
    expect(result.success).toBe(false)
  })

  it("should reject invalid creatorAddress", () => {
    const result = validateManifest({
      ...validManifest,
      creatorAddress: "not-an-address",
    })
    expect(result.success).toBe(false)
  })

  it("should accept manifest with pricing", () => {
    const result = validateManifest({
      ...validManifest,
      pricing: [
        {
          amount: "20000",
          asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          recipient: "eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01",
          protocol: "x402",
        },
      ],
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.pricing).toHaveLength(1)
  })

  it("should accept manifest without optional fields", () => {
    const minimal = {
      name: "test-tool",
      description: "A test tool",
      endpoint: "https://test.example.com",
      inputs: {},
      outputs: {},
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }
    const result = validateManifest(minimal)
    expect(result.success).toBe(true)
  })

  it("should accept manifest with valid access block", () => {
    const result = validateManifest({
      ...validManifest,
      access: {
        logic: "AND",
        requirements: [
          {
            kind: "0xbdf9dc18",
            data: "0x",
            label: "",
          },
        ],
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.access?.requirements).toHaveLength(1)
  })

  it("should accept access with OR logic and links", () => {
    const result = validateManifest({
      ...validManifest,
      access: {
        logic: "OR",
        requirements: [
          {
            kind: "0xabcd1234",
            data: "0x07152bfd",
            label: "Hold any Chonk on Base",
            links: {
              buy: "https://opensea.io/collection/chonks",
            },
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it("should reject access with empty requirements array", () => {
    const result = validateManifest({
      ...validManifest,
      access: {
        logic: "AND",
        requirements: [],
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject access with invalid kind hex", () => {
    const result = validateManifest({
      ...validManifest,
      access: {
        logic: "AND",
        requirements: [
          {
            kind: "0xinvalid",
            data: "0x",
            label: "",
          },
        ],
      },
    })
    expect(result.success).toBe(false)
  })

  it("should accept manifest with self-attested standard verifiability", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "standard",
        dataRetention: "metadata-only",
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.verifiability?.tier).toBe("self-attested")
    expect(result.data.verifiability?.execution).toBe("standard")
    expect(result.data.verifiability?.dataRetention).toBe("metadata-only")
  })

  it("should accept manifest with hardware-attested TEE verifiability", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        description: "Runs inside Intel SGX enclave.",
        dataRetention: "ephemeral",
        sourceVisibility: "open-source",
        attestation: {
          type: "dcap-v3",
          endpoint: "https://tools.example.com/.well-known/attestation",
          enclaveHash:
            "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          maxAge: 3600,
          transparencyLogURI:
            "https://rekor.sigstore.dev/api/v1/log/entries/abc123",
        },
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.verifiability?.tier).toBe("hardware-attested")
    expect(result.data.verifiability?.execution).toBe("tee")
    expect(result.data.verifiability?.attestation?.type).toBe("dcap-v3")
    expect(result.data.verifiability?.attestation?.maxAge).toBe(3600)
    expect(result.data.verifiability?.attestation?.transparencyLogURI).toBe(
      "https://rekor.sigstore.dev/api/v1/log/entries/abc123",
    )
  })

  it("should accept manifest with verifiable E2EE and reproducible build", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "verifiable",
        execution: "e2ee",
        dataRetention: "none",
        sourceVisibility: "open-source",
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
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.verifiability?.tier).toBe("verifiable")
    expect(result.data.verifiability?.execution).toBe("e2ee")
    expect(result.data.verifiability?.reproducibleBuild?.sourceCodeURI).toBe(
      "https://github.com/example/tool/tree/abc123",
    )
  })

  it("should accept verifiability with reverse-DNS execution value", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "io.phala.tee-sidevm",
      },
    })
    expect(result.success).toBe(true)
  })

  it("should accept verifiability with only tier and execution", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "standard",
      },
    })
    expect(result.success).toBe(true)
  })

  it("should reject verifiability with missing tier", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        execution: "standard",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with invalid tier", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "invalid-tier",
        execution: "standard",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with missing execution", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        dataRetention: "none",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with empty execution", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with invalid dataRetention", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "standard",
        dataRetention: "invalid-value",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with invalid sourceVisibility", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        sourceVisibility: "invalid-value",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with http endpoint", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "dcap-v3",
          endpoint: "http://insecure.example.com/attestation",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with invalid enclaveHash", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "dcap-v3",
          enclaveHash: "not-hex",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with empty type", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with description exceeding 500 chars", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "tee",
        description: "a".repeat(501),
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with http transparencyLogURI", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "dcap-v3",
          transparencyLogURI: "http://insecure.example.com/log",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with non-positive maxAge", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "dcap-v3",
          maxAge: 0,
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject reproducibleBuild with http sourceCodeURI", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "verifiable",
        execution: "tee",
        reproducibleBuild: {
          sourceCodeURI: "http://insecure.example.com/repo",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject reproducibleBuild with invalid buildHash", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "verifiable",
        execution: "tee",
        reproducibleBuild: {
          sourceCodeURI: "https://github.com/example/tool",
          buildHash: "not-hex",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject verifiability with empty description", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "self-attested",
        execution: "standard",
        description: "",
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject attestation with odd-length enclaveHash", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "hardware-attested",
        execution: "tee",
        attestation: {
          type: "dcap-v3",
          enclaveHash: "0xabc",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should reject reproducibleBuild with odd-length buildHash", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "verifiable",
        execution: "tee",
        reproducibleBuild: {
          sourceCodeURI: "https://github.com/example/tool",
          buildHash: "0xabc",
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("should accept reproducibleBuild with only sourceCodeURI", () => {
    const result = validateManifest({
      ...validManifest,
      verifiability: {
        tier: "verifiable",
        execution: "tee",
        reproducibleBuild: {
          sourceCodeURI: "https://github.com/example/tool/tree/abc123",
        },
      },
    })
    expect(result.success).toBe(true)
  })
})

describe("validateManifest — JSON Schema structure", () => {
  it("should accept valid JSON Schema with type, properties, and required", () => {
    const result = validateManifest(validManifest)
    expect(result.success).toBe(true)
  })

  it("should accept empty inputs/outputs", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: {},
      outputs: {},
    })
    expect(result.success).toBe(true)
  })

  it("should accept array-type schema with items", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: {
        type: "array",
        items: { type: "string" },
      },
    })
    expect(result.success).toBe(true)
  })

  it("should accept schema without type field", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: { properties: { foo: { type: "string" } } },
    })
    expect(result.success).toBe(true)
  })

  it("should reject inputs with non-string type", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: { type: 123 },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain(
      "inputs.type must be a string or an array of strings",
    )
  })

  it("should reject outputs with non-string type", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: { type: true },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain(
      "outputs.type must be a string or an array of strings",
    )
  })

  it("should reject properties that is not an object", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: { type: "object", properties: "not-an-object" },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("inputs.properties must be an object")
  })

  it("should reject properties that is an array", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: { type: "object", properties: [] },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("outputs.properties must be an object")
  })

  it("should reject a property value that is not an object", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: {
        type: "object",
        properties: { bad: "string-instead-of-schema" },
      },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("inputs.properties.bad must be an object")
  })

  it("should reject required that is not an array", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: {
        type: "object",
        properties: { a: { type: "string" } },
        required: "a",
      },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("outputs.required must be an array of strings")
  })

  it("should reject required containing non-strings", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: {
        type: "object",
        properties: { a: { type: "string" } },
        required: [1, 2],
      },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("inputs.required must be an array of strings")
  })

  it("should reject items that is not an object", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: { type: "array", items: "string" },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("outputs.items must be an object")
  })

  it("should reject items that is an array", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: { type: "array", items: [{ type: "string" }] },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain("outputs.items must be an object")
  })

  it("should validate nested property schemas recursively", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              deep: { type: 42 },
            },
          },
        },
      },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain(
      "inputs.properties.nested.properties.deep.type must be a string or an array of strings",
    )
  })

  it("should validate nested items schemas recursively", () => {
    const result = validateManifest({
      ...validManifest,
      outputs: {
        type: "array",
        items: {
          type: "object",
          required: { not: "an-array" },
        },
      },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain(
      "outputs.items.required must be an array of strings",
    )
  })

  it("should report multiple structural errors at once", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: { type: 123, required: "bad" },
      outputs: { properties: "bad" },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3)
  })

  it("should accept type as an array of strings (Draft-7 union)", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: {
        type: "object",
        properties: {
          nullable: { type: ["string", "null"] },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it("should reject type as an array containing non-strings", () => {
    const result = validateManifest({
      ...validManifest,
      inputs: { type: ["string", 42] },
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(messages).toContain(
      "inputs.type must be a string or an array of strings",
    )
  })

  it("should reject schemas exceeding maximum nesting depth", () => {
    let nested: Record<string, unknown> = { type: "string" }
    for (let i = 0; i < 35; i++) {
      nested = {
        type: "object",
        properties: { x: nested },
      }
    }
    const result = validateManifest({
      ...validManifest,
      inputs: nested,
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    const messages = result.error.issues.map(i => i.message)
    expect(
      messages.some(m => m.includes("exceeds maximum nesting depth")),
    ).toBe(true)
  })
})

describe("defineManifest", () => {
  it("should return the same manifest with static values", () => {
    const result = defineManifest(validManifest as ManifestDefinition)
    expect(result).toEqual(validManifest)
  })

  it("should accept resolver functions for endpoint, creatorAddress, pricing", () => {
    const definition = defineManifest({
      ...validManifest,
      endpoint: env => env.TOOL_ENDPOINT!,
      creatorAddress: env => env.CREATOR_ADDRESS!,
      pricing: env => [
        {
          amount: env.PRICE_AMOUNT!,
          asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          recipient: env.PRICE_RECIPIENT!,
          protocol: "x402",
        },
      ],
    })
    expect(typeof definition.endpoint).toBe("function")
    expect(typeof definition.creatorAddress).toBe("function")
    expect(typeof definition.pricing).toBe("function")
  })
})

describe("resolveManifest", () => {
  it("should pass through a static-only manifest unchanged", () => {
    const definition = defineManifest(validManifest as ManifestDefinition)
    const resolved = resolveManifest(definition, {})
    expect(resolved.endpoint).toBe("https://tools.example.com/nft-price-oracle")
    expect(resolved.creatorAddress).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef123456",
    )
    expect(resolved.name).toBe("nft-price-oracle")
  })

  it("should resolve function-valued fields with provided env", () => {
    const definition = defineManifest({
      ...validManifest,
      endpoint: env => env.TOOL_ENDPOINT!,
      creatorAddress: env => env.CREATOR!,
    })
    const env = {
      TOOL_ENDPOINT: "https://my-worker.example.com/tool",
      CREATOR: "0x1234567890abcdef1234567890abcdef12345678",
    }
    const resolved = resolveManifest(definition, env)
    expect(resolved.endpoint).toBe("https://my-worker.example.com/tool")
    expect(resolved.creatorAddress).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    )
  })

  it("should resolve a mixed manifest (some static, some resolver)", () => {
    const definition = defineManifest({
      ...validManifest,
      endpoint: env => env.TOOL_ENDPOINT!,
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
      pricing: env => [
        {
          amount: env.PRICE!,
          asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          recipient: "eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01",
          protocol: "x402",
        },
      ],
    })
    const env = {
      TOOL_ENDPOINT: "https://resolved.example.com/tool",
      PRICE: "50000",
    }
    const resolved = resolveManifest(definition, env)
    expect(resolved.endpoint).toBe("https://resolved.example.com/tool")
    expect(resolved.creatorAddress).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef123456",
    )
    expect(resolved.pricing).toEqual([
      {
        amount: "50000",
        asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        recipient: "eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01",
        protocol: "x402",
      },
    ])
  })

  it("should throw a descriptive error when a resolver returns undefined", () => {
    const definition = defineManifest({
      ...validManifest,
      endpoint: env => env.MISSING_VAR as string,
    })
    expect(() => resolveManifest(definition, {})).toThrow(
      /Resolver for "endpoint" returned undefined/,
    )
  })

  it("should throw a descriptive error when a resolver returns null", () => {
    const definition = defineManifest({
      ...validManifest,
      creatorAddress: () => null as unknown as string,
    })
    expect(() => resolveManifest(definition, {})).toThrow(
      /Resolver for "creatorAddress" returned null/,
    )
  })

  it("should throw when a resolver returns a schema-invalid value", () => {
    const definition = defineManifest({
      ...validManifest,
      endpoint: () => "http://not-https.example.com",
    })
    expect(() => resolveManifest(definition, {})).toThrow(
      /Resolved manifest is invalid/,
    )
  })

  it("should leave pricing undefined when not provided", () => {
    const definition = defineManifest({
      type: validManifest.type,
      name: validManifest.name,
      description: validManifest.description,
      endpoint: validManifest.endpoint,
      inputs: validManifest.inputs,
      outputs: validManifest.outputs,
      creatorAddress: validManifest.creatorAddress,
    })
    const resolved = resolveManifest(definition, {})
    expect(resolved.pricing).toBeUndefined()
  })
})
