import type { Address } from "viem"
import type { CAIP19ToolRef } from "./types.js"

/**
 * Parses a CAIP-19 asset identifier for an ERC-8257 tool registration.
 *
 * Expected format: `eip155:<chainId>/erc8257:<registryAddress>/<toolId>`
 *
 * @throws if the string does not match the expected format.
 */
export function parseCAIP19ToolRef(raw: string): CAIP19ToolRef {
  const match = raw.match(
    /^eip155:(\d+)\/erc8257:(0x[0-9a-fA-F]{40})\/(\d+)$/,
  )
  if (!match) {
    throw new Error(
      `Invalid CAIP-19 tool reference: "${raw}". ` +
        "Expected format: eip155:<chainId>/erc8257:<registryAddress>/<toolId>",
    )
  }
  return {
    raw,
    chainId: Number(match[1]),
    registryAddress: match[2].toLowerCase() as Address,
    toolId: BigInt(match[3]),
  }
}

/**
 * Formats a CAIP-19 tool reference back to its canonical string form.
 */
export function formatCAIP19ToolRef(ref: CAIP19ToolRef): string {
  return `eip155:${ref.chainId}/erc8257:${ref.registryAddress}/${ref.toolId}`
}
