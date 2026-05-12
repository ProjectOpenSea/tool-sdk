import { encodeAbiParameters, getAddress } from "viem"
import { describe, expect, it } from "vitest"
import {
  type AccessRequirementInfo,
  decodeRequirement,
  ERC721_KIND,
  ERC1155_KIND,
  SUBSCRIPTION_KIND,
  WALLET_STATE_ATTESTATION_KIND,
} from "../lib/onchain/access.js"

const COLLECTION = getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa")

describe("decodeRequirement", () => {
  it("decodes an ERC-721 holding requirement", () => {
    const data = encodeAbiParameters([{ type: "address" }], [COLLECTION])
    const req: AccessRequirementInfo = {
      kind: ERC721_KIND,
      data,
      label: "Hold an NFT",
    }
    expect(decodeRequirement(req)).toEqual({
      type: "erc721",
      collection: COLLECTION,
    })
  })

  it("decodes an ERC-1155 holding requirement", () => {
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [COLLECTION, 42n],
    )
    const req: AccessRequirementInfo = {
      kind: ERC1155_KIND,
      data,
      label: "Hold token #42",
    }
    expect(decodeRequirement(req)).toEqual({
      type: "erc1155",
      collection: COLLECTION,
      tokenId: 42n,
    })
  })

  it("decodes a subscription requirement", () => {
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint8" }],
      [COLLECTION, 2],
    )
    const req: AccessRequirementInfo = {
      kind: SUBSCRIPTION_KIND,
      data,
      label: "Pro tier",
    }
    expect(decodeRequirement(req)).toEqual({
      type: "subscription",
      collection: COLLECTION,
      minTier: 2,
    })
  })

  it("decodes a wallet-state-attestation requirement", () => {
    const issuerJwksUri = "https://issuer.example.com/.well-known/jwks.json"
    const conditionHash =
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const
    const data = encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [issuerJwksUri, conditionHash],
    )
    const req: AccessRequirementInfo = {
      kind: WALLET_STATE_ATTESTATION_KIND,
      data,
      label: "Cross-chain wallet attestation",
    }
    expect(decodeRequirement(req)).toEqual({
      type: "walletStateAttestation",
      issuerJwksUri,
      conditionHash,
    })
  })

  it("returns unknown for an unrecognized kind", () => {
    const req: AccessRequirementInfo = {
      kind: "0xdeadbeef",
      data: "0xc0ffee",
      label: "Mystery",
    }
    expect(decodeRequirement(req)).toEqual({
      type: "unknown",
      kind: "0xdeadbeef",
      data: "0xc0ffee",
    })
  })
})
