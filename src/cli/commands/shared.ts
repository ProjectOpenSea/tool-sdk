import pc from "picocolors"
import type { Chain } from "viem"
import { WALLET_PROVIDERS } from "../../lib/wallet/index.js"
import { defaultRpcUrl } from "./get-chain.js"

/** Help text for the `--wallet-provider` CLI option, shared across commands. */
export const WALLET_PROVIDER_OPTION_DESCRIPTION = `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`

/** Help text for the `--rpc-url` CLI option, shared across commands. */
export const RPC_URL_OPTION_DESCRIPTION =
  "RPC endpoint (falls back to the RPC_URL env var, then the network's default public RPC)"

/**
 * Resolve the RPC URL for a command, in priority order:
 * `--rpc-url` flag > wallet-provided RPC > `RPC_URL` env var.
 *
 * Returns `undefined` when none is configured (viem then uses the chain's
 * default public RPC) and prints a warning, since public RPCs can be slow,
 * rate-limited, or unreachable — a common cause of commands appearing to
 * hang on onchain reads.
 */
export function resolveRpcUrl(
  cliRpcUrl: string | undefined,
  wallet: { getRpcUrl?: () => string | undefined } | undefined,
  chain: Chain,
): string | undefined {
  const rpcUrl = cliRpcUrl ?? wallet?.getRpcUrl?.() ?? process.env.RPC_URL
  if (rpcUrl) return rpcUrl
  console.log(
    pc.yellow(
      `No RPC endpoint configured — using the default public RPC (${defaultRpcUrl(chain)}). ` +
        "If this is slow or hangs, pass --rpc-url or set the RPC_URL env var.",
    ),
  )
  return undefined
}

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
