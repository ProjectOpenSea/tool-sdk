import type { WalletAdapter } from "@opensea/wallet-adapters"
import type {
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequired,
  PaymentRequirements as X402PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types"
import type { Account } from "viem"
import { toHex } from "viem"
import { resolveNetwork } from "./x402-challenge.js"
import type { PaymentRequirements } from "./x402-payment.js"

/**
 * x402 foundation SchemeNetworkClient wrapping tool-sdk's EIP-3009
 * TransferWithAuthorization signing. Allows `paidFetch` and
 * `paidAuthenticatedFetch` to create payment payloads via the standard
 * x402Client → SchemeNetworkClient pipeline.
 */
export class ExactEip3009Scheme implements SchemeNetworkClient {
  readonly scheme = "exact"

  constructor(private readonly signer: WalletAdapter | Account) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: X402PaymentRequirements,
    _context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const payload = await signEip3009Authorization(this.signer, {
      network: paymentRequirements.network,
      payTo: paymentRequirements.payTo,
      asset: paymentRequirements.asset,
      amount: paymentRequirements.amount,
      extra: paymentRequirements.extra,
    })

    if (x402Version === 1) {
      return {
        x402Version,
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network,
        payload,
      } as PaymentPayloadResult
    }

    return { x402Version, payload }
  }
}

/**
 * Core EIP-3009 TransferWithAuthorization signing logic shared by
 * {@link ExactEip3009Scheme} and the standalone {@link signX402Payment}.
 */
export async function signEip3009Authorization(
  signer: WalletAdapter | Account,
  reqs: {
    network: string
    payTo: string
    asset: string
    amount?: string
    maxAmountRequired?: string
    extra?: Record<string, unknown>
  },
): Promise<{ signature: string; authorization: Record<string, string> }> {
  const resolved = resolveNetwork(reqs.network)
  if (resolved === undefined) {
    throw new Error(`Unsupported network: ${reqs.network}`)
  }
  const { chainId } = resolved

  const isAdapter = "capabilities" in signer
  const address = isAdapter
    ? await (signer as WalletAdapter).getAddress()
    : (signer as Account).address

  const nonceBytes = new Uint8Array(32)
  crypto.getRandomValues(nonceBytes)
  const nonce = toHex(nonceBytes)

  const validAfter = "0"
  const validBefore = String(Math.floor(Date.now() / 1000) + 600)

  const value = reqs.amount ?? reqs.maxAmountRequired ?? "0"

  const authorization = {
    from: address as `0x${string}`,
    to: reqs.payTo as `0x${string}`,
    value,
    validAfter,
    validBefore,
    nonce,
  } as const

  const domain = {
    name: (reqs.extra?.name as string) ?? "USD Coin",
    version: (reqs.extra?.version as string) ?? "2",
    chainId,
    verifyingContract: reqs.asset as `0x${string}`,
  }
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  }

  let signature: string
  if (isAdapter) {
    const adapter = signer as WalletAdapter
    if (!adapter.capabilities.signTypedData || !adapter.signTypedData) {
      throw new Error(
        `Wallet provider "${adapter.name}" does not support signTypedData`,
      )
    }
    signature = await adapter.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
    })
  } else {
    const account = signer as Account
    if (!account.signTypedData) {
      throw new Error(
        "account.signTypedData is required — use a Local Account (e.g. privateKeyToAccount)",
      )
    }
    signature = await account.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization" as const,
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    })
  }

  return {
    signature,
    authorization: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  }
}

/**
 * Build an x402 foundation `PaymentRequired` from a parsed tool-sdk challenge,
 * suitable for passing to `x402Client.createPaymentPayload()`.
 */
export function toX402PaymentRequired(parsed: {
  requirements: PaymentRequirements
  x402Version: number
  raw: Record<string, unknown>
  resource?: unknown
}): PaymentRequired {
  const { requirements, x402Version, raw, resource } = parsed
  return {
    x402Version,
    resource: (resource as { url: string; mimeType: string }) ?? {
      url: "",
      mimeType: "",
    },
    accepts: [
      {
        scheme: requirements.scheme,
        network: requirements.network as `${string}:${string}`,
        asset: requirements.asset,
        amount: requirements.maxAmountRequired,
        payTo: requirements.payTo,
        maxTimeoutSeconds:
          (raw.maxTimeoutSeconds as number) ?? 600,
        extra: (requirements.extra as Record<string, unknown>) ?? {},
      },
    ],
  }
}
