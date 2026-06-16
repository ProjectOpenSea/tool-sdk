import pc from "picocolors"
import { findBareExtensionKeys } from "../../lib/manifest/index.js"

/**
 * Warns when a manifest carries un-namespaced extension fields.
 *
 * The manifest is hashed as served (ERC-8257 §2), so these fields are
 * committed onchain. But ERC-8257 requires extension fields to be namespaced,
 * and bare top-level names risk colliding with future normative fields. The
 * warning is written to stderr so commands that print the hash to stdout
 * (e.g. `hash`) stay pipeable.
 */
export function warnBareExtensionKeys(data: unknown): void {
  const keys = findBareExtensionKeys(data)
  if (keys.length === 0) return

  const noun = keys.length === 1 ? "field" : "fields"
  console.warn(
    pc.yellow(
      `Warning: manifest has ${keys.length} un-namespaced extension ${noun}:\n` +
        `${keys.map(k => `  - ${k}`).join("\n")}\n` +
        "These fields are committed by the manifest hash, but ERC-8257 requires " +
        "extension fields to be namespaced. Use a reverse-DNS prefix " +
        "(e.g. io.opensea.paymentHint) so they cannot collide with future " +
        "fields added by the spec.",
    ),
  )
}
