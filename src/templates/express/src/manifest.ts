import { defineManifest } from "@opensea/tool-sdk"

export const manifest = defineManifest({
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "{{TOOL_NAME}}",
  description: "{{TOOL_DESCRIPTION}}",
  endpoint: "{{TOOL_ENDPOINT}}",
  inputs: {
    type: "object",
    properties: {
      query: { type: "string", description: "Input query" },
    },
    required: ["query"],
  },
  outputs: {
    type: "object",
    properties: {
      result: { type: "string" },
    },
  },
  creatorAddress: "{{CREATOR_ADDRESS}}",
})
