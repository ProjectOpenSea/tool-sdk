import canonicalize from "canonicalize"
import { keccak256, toBytes } from "viem"

/**
 * Computes the ERC-8257 manifest hash: keccak256 over the JCS (RFC 8785)
 * canonicalization of the manifest.
 *
 * Per ERC-8257 §2, the manifest is hashed *as served*: the full JSON document
 * including any namespaced extension fields, with no schema stripping and no
 * injected defaults. Callers MUST pass the raw served/authored object (for
 * example the fetched response body), not a schema-stripped copy, so that an
 * independently computed hash agrees with this one.
 */
export function computeManifestHash(manifest: object): `0x${string}` {
  const canonical = canonicalize(manifest)
  if (!canonical) throw new Error("Failed to canonicalize manifest")
  return keccak256(toBytes(canonical))
}
