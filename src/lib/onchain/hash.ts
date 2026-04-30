import canonicalize from "canonicalize"
import { keccak256, toBytes } from "viem"
import type { ToolManifest } from "../manifest/types.js"

export function computeManifestHash(
  manifest: ToolManifest,
): `0x${string}` {
  const canonical = canonicalize(manifest)
  if (!canonical) throw new Error("Failed to canonicalize manifest")
  return keccak256(toBytes(canonical))
}
