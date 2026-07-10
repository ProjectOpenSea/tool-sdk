import pc from "picocolors"
import { WALLET_PROVIDERS } from "../../lib/wallet/index.js"

/** Help text for the `--wallet-provider` CLI option, shared across commands. */
export const WALLET_PROVIDER_OPTION_DESCRIPTION = `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`

/**
 * Parse a CLI-supplied tool ID into a bigint, exiting with a red error on
 * failure. Shared across the onchain commands.
 */
export function parseToolId(
  raw: string,
  errorMessage = "Error: toolId must be a valid integer",
): bigint {
  try {
    return BigInt(raw)
  } catch {
    console.error(pc.red(errorMessage))
    process.exit(1)
  }
}
