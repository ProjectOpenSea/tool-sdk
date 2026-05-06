import { defineManifest } from "@opensea/tool-sdk"

// Tip: Use resolver functions to read env vars at request time instead of
// at module-init time:
//   endpoint: env => env.TOOL_ENDPOINT!,
//   creatorAddress: env => env.CREATOR_ADDRESS!,
export const manifest = defineManifest({
  type: "https://eips.ethereum.org/EIPS/eip-draft#tool-manifest-v1",
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
