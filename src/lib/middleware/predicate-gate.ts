import {
  type Chain,
  createPublicClient,
  http,
  recoverTypedDataAddress,
} from "viem"
import { base } from "viem/chains"
import { parseSiweMessage } from "viem/siwe"
import type { GateMiddleware, ToolContext } from "../../types.js"
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
} from "../middleware/x402-facilitators.js"
import { IDelegateRegistryABI } from "../onchain/abis.js"
import { DELEGATE_REGISTRY } from "../onchain/chains.js"
import { ToolRegistryClient } from "../onchain/registry.js"
import type { ZeroValueAuthorization } from "../usage/eip3009-auth.js"

const NETWORK_USDC: Record<number, `0x${string}`> = {
  8453: USDC_BASE_ADDRESS as `0x${string}`,
  84532: USDC_BASE_SEPOLIA_ADDRESS as `0x${string}`,
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const

export interface PredicateGateConfig {
  /**
   * Onchain tool ID. Obtained from the `ToolRegistered` event when the tool
   * is registered against the canonical `ToolRegistry`.
   */
  toolId: bigint
  /**
   * Chain where the registry is deployed. Defaults to Base.
   */
  chain?: Chain
  /**
   * RPC URL for read calls (SIWE verify + registry staticcall). Defaults to
   * the chain's public RPC.
   */
  rpcUrl?: string
  /**
   * Optional bytes forwarded as the `data` argument to the predicate. Most
   * predicates ignore this; supply it only when the configured predicate
   * documents a use for it.
   */
  data?: `0x${string}`
  /**
   * Override the canonical registry address. Useful for local development
   * against a forked Anvil node or a custom deploy.
   */
  registryAddress?: `0x${string}`
  /**
   * Override the delegate.xyz DelegateRegistry address. Useful for local
   * development against a forked Anvil node.
   */
  delegateRegistryAddress?: `0x${string}`
  /**
   * Tool operator address. When set, EIP-3009 authorizations are validated
   * to ensure their `to` field matches this address (domain binding). If
   * unset, any `to` address is accepted (including `0x0`).
   */
  operatorAddress?: `0x${string}`
}

/**
 * Server-side gate that delegates access decisions to the onchain
 * `ToolRegistry`. Accepts either EIP-3009 zero-value authorization (preferred)
 * or SIWE auth (deprecated), recovers the caller's address, and staticcalls
 * `tryHasAccess(toolId, caller, data)` on the registry.
 *
 * **Auth schemes (in order of preference):**
 *
 * 1. `Authorization: EIP-3009 <base64url(json)>` — zero-value
 *    `TransferWithAuthorization` signature. Pure `ecrecover` verification,
 *    no RPC needed. Preferred for new integrations.
 * 2. `Authorization: SIWE <base64url(message)>.<signature>` — deprecated.
 *    Requires an RPC call to verify the SIWE message.
 *
 * **Access results:**
 * - `(ok=true, granted=true)`: gate passes; sets `ctx.callerAddress`.
 * - `(ok=true, granted=false)`: returns `403` with the registered predicate
 *   address in the body so the caller can self-diagnose.
 * - `(ok=false, *)`: returns `502` (predicate misbehaved upstream).
 *
 * **Delegated agent access:** When the request includes an
 * `X-Delegate-For: <holderAddress>` header, the gate verifies the caller
 * normally, then checks the delegate.xyz DelegateRegistry to confirm
 * the holder has delegated to the caller. If valid, the access predicate
 * runs against the **holder** (not the agent), and `ctx.agentAddress` is set.
 *
 * The registry is the source of truth for access policy; this middleware just
 * consults it.
 */
export function predicateGate(config: PredicateGateConfig): GateMiddleware {
  const chain = config.chain ?? base
  const rpcUrl = config.rpcUrl ?? "https://mainnet.base.org"

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const registry = new ToolRegistryClient({
    chain,
    rpcUrl,
    registryAddress: config.registryAddress,
  })

  const delegateRegistryAddress =
    config.delegateRegistryAddress ?? DELEGATE_REGISTRY.address

  const PREDICATE_CACHE_TTL_MS = 5 * 60 * 1000
  let cached: {
    address: `0x${string}`
    fetchedAt: number
  } | null = null
  let inflight: Promise<`0x${string}`> | null = null
  function loadPredicateAddress(): Promise<`0x${string}`> {
    if (cached && Date.now() - cached.fetchedAt < PREDICATE_CACHE_TTL_MS) {
      return Promise.resolve(cached.address)
    }
    if (!inflight) {
      inflight = registry
        .getToolConfig(config.toolId)
        .then((c) => {
          cached = { address: c.accessPredicate, fetchedAt: Date.now() }
          inflight = null
          return c.accessPredicate
        })
        .catch((err) => {
          inflight = null
          throw err
        })
    }
    return inflight
  }

  return {
    async check(
      request: Request,
      ctx: Partial<ToolContext>,
    ): Promise<Response | null> {
      const authHeader = request.headers.get("Authorization")

      if (!authHeader) {
        return Response.json(
          {
            error: "Predicate gate: authorization required",
            hint: "Include Authorization: EIP-3009 <base64url(json)> or Authorization: SIWE <base64url(message)>.<signature>",
          },
          { status: 401 },
        )
      }

      let recoveredAddress: `0x${string}` | null = null
      let callerAuthorization: ZeroValueAuthorization | undefined

      if (authHeader.startsWith("EIP-3009 ")) {
        const result = await verifyEip3009Auth(authHeader, config, chain)
        if (result.error) {
          return Response.json(
            { error: result.error },
            { status: result.status },
          )
        }
        recoveredAddress = result.address!
        callerAuthorization = result.authorization
      } else if (authHeader.startsWith("SIWE ")) {
        const result = await verifySiweAuth(
          authHeader,
          request,
          publicClient,
        )
        if (result.error) {
          return Response.json(
            { error: result.error },
            { status: result.status },
          )
        }
        recoveredAddress = result.address!
      } else {
        return Response.json(
          {
            error: "Predicate gate: authorization required",
            hint: "Include Authorization: EIP-3009 <base64url(json)> or Authorization: SIWE <base64url(message)>.<signature>",
          },
          { status: 401 },
        )
      }

      if (!recoveredAddress) {
        return Response.json(
          { error: "Predicate gate: could not recover caller address" },
          { status: 401 },
        )
      }

      // Determine whose address to check the predicate against.
      const delegateForRaw = request.headers.get("X-Delegate-For")
      let predicateSubject = recoveredAddress
      let agentAddress: `0x${string}` | undefined

      if (delegateForRaw) {
        const HEX_RE = /^0x[0-9a-fA-F]{40}$/
        if (!HEX_RE.test(delegateForRaw)) {
          return Response.json(
            {
              error:
                "Predicate gate: invalid X-Delegate-For header (expected 0x-prefixed address)",
            },
            { status: 400 },
          )
        }
        const holderAddress = delegateForRaw as `0x${string}`

        let isDelegateValid: boolean
        try {
          isDelegateValid = await publicClient.readContract({
            address: delegateRegistryAddress,
            abi: IDelegateRegistryABI,
            functionName: "checkDelegateForAll",
            args: [
              recoveredAddress,
              holderAddress,
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            ],
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown error"
          return Response.json(
            {
              error: `Predicate gate: delegate registry call failed (${reason})`,
            },
            { status: 502 },
          )
        }

        if (!isDelegateValid) {
          return Response.json(
            {
              error:
                "Predicate gate: delegate.xyz delegation not found — holder has not delegated to this agent",
              hint: "The holder must delegate to the agent at https://delegate.xyz",
            },
            { status: 403 },
          )
        }

        predicateSubject = holderAddress
        agentAddress = recoveredAddress
      }

      const data = config.data ?? "0x"
      let result: { ok: boolean; granted: boolean }
      try {
        result = await registry.tryHasAccess(
          config.toolId,
          predicateSubject,
          data,
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown error"
        return Response.json(
          {
            error: `Predicate gate: registry call failed (${reason})`,
          },
          { status: 502 },
        )
      }

      if (!result.ok) {
        return Response.json(
          {
            error:
              "Predicate gate: predicate misbehaved (registry tryHasAccess returned ok=false)",
          },
          { status: 502 },
        )
      }

      if (!result.granted) {
        let predicate: `0x${string}` | undefined
        try {
          predicate = await loadPredicateAddress()
        } catch {
          predicate = undefined
        }
        return Response.json(
          {
            error: "Predicate gate: access predicate denied",
            toolId: config.toolId.toString(),
            predicate,
          },
          { status: 403 },
        )
      }

      ctx.callerAddress = predicateSubject
      if (agentAddress) {
        ctx.agentAddress = agentAddress
      }
      if (callerAuthorization) {
        ctx.callerAuthorization = callerAuthorization
      }
      if (ctx.gates) {
        ctx.gates.predicate = { granted: true }
      }
      return null
    },
  }
}

// ---------------------------------------------------------------------------
// EIP-3009 verification (preferred)
// ---------------------------------------------------------------------------

interface AuthResult {
  address?: `0x${string}`
  /** The verified caller authorization (EIP-3009 path only). */
  authorization?: ZeroValueAuthorization
  error?: string
  status: number
}

async function verifyEip3009Auth(
  authHeader: string,
  config: PredicateGateConfig,
  chain: Chain,
): Promise<AuthResult> {
  const token = authHeader.slice("EIP-3009 ".length)

  let decoded: string
  try {
    decoded = Buffer.from(token, "base64url").toString("utf-8")
  } catch {
    return {
      error: "Predicate gate: invalid EIP-3009 token (bad base64url)",
      status: 401,
    }
  }

  let authorization: ZeroValueAuthorization
  try {
    authorization = JSON.parse(decoded) as ZeroValueAuthorization
  } catch {
    return {
      error: "Predicate gate: invalid EIP-3009 token (bad JSON)",
      status: 401,
    }
  }

  if (
    !authorization.from ||
    !authorization.to ||
    !authorization.signature ||
    !authorization.nonce
  ) {
    return {
      error:
        "Predicate gate: EIP-3009 token missing required fields (from, to, signature, nonce)",
      status: 401,
    }
  }

  if (authorization.value !== "0") {
    return {
      error: "Predicate gate: EIP-3009 authorization must have value=0",
      status: 401,
    }
  }

  // Validate operator binding
  if (
    config.operatorAddress &&
    authorization.to.toLowerCase() !== config.operatorAddress.toLowerCase()
  ) {
    return {
      error: `Predicate gate: EIP-3009 'to' address mismatch (expected ${config.operatorAddress})`,
      status: 401,
    }
  }

  // Check expiry (validBefore)
  if (authorization.validBefore !== undefined) {
    const validBefore = BigInt(authorization.validBefore)
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    if (nowSec >= validBefore) {
      return {
        error: "Predicate gate: EIP-3009 authorization expired",
        status: 401,
      }
    }
  }

  // Check not-before (validAfter)
  if (authorization.validAfter !== undefined && authorization.validAfter !== "0") {
    const validAfter = BigInt(authorization.validAfter)
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    if (nowSec < validAfter) {
      return {
        error: "Predicate gate: EIP-3009 authorization not yet valid",
        status: 401,
      }
    }
  }

  const chainId = authorization.chainId ?? chain.id
  const tokenAddress = NETWORK_USDC[chainId]
  if (!tokenAddress) {
    return {
      error: `Predicate gate: unsupported chainId ${chainId} for EIP-3009`,
      status: 401,
    }
  }

  let recoveredAddress: `0x${string}`
  try {
    recoveredAddress = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId,
        verifyingContract: tokenAddress,
      },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature: authorization.signature,
    })
  } catch {
    return {
      error: "Predicate gate: invalid EIP-3009 signature",
      status: 401,
    }
  }

  if (recoveredAddress.toLowerCase() !== authorization.from.toLowerCase()) {
    return {
      error: "Predicate gate: EIP-3009 signer does not match 'from' address",
      status: 401,
    }
  }

  return { address: recoveredAddress, authorization, status: 200 }
}

// ---------------------------------------------------------------------------
// SIWE verification (deprecated — kept for backward compatibility)
// ---------------------------------------------------------------------------

async function verifySiweAuth(
  authHeader: string,
  request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OP Stack chains widen the transaction union; safe because we only call verifySiweMessage
  publicClient: { verifySiweMessage: (...args: any[]) => Promise<boolean> },
): Promise<AuthResult> {
  const token = authHeader.slice("SIWE ".length)
  const dotIndex = token.lastIndexOf(".")
  if (dotIndex === -1) {
    return {
      error: "Predicate gate: invalid SIWE token format",
      status: 401,
    }
  }

  const messageB64 = token.slice(0, dotIndex)
  const signatureRaw = token.slice(dotIndex + 1)
  if (!signatureRaw.startsWith("0x")) {
    return {
      error: "Predicate gate: invalid SIWE signature",
      status: 401,
    }
  }
  const signature = signatureRaw as `0x${string}`

  let messageStr: string
  try {
    messageStr = Buffer.from(messageB64, "base64url").toString("utf-8")
  } catch {
    return {
      error: "Predicate gate: invalid SIWE signature",
      status: 401,
    }
  }

  let siweMessage: ReturnType<typeof parseSiweMessage>
  try {
    siweMessage = parseSiweMessage(messageStr)
  } catch {
    return {
      error: "Predicate gate: invalid SIWE signature",
      status: 401,
    }
  }

  const requestDomain = new URL(request.url).host
  if (siweMessage.domain !== requestDomain) {
    return {
      error: "Predicate gate: SIWE domain mismatch",
      status: 401,
    }
  }

  if (
    siweMessage.expirationTime &&
    siweMessage.expirationTime < new Date()
  ) {
    return {
      error: "Predicate gate: SIWE message expired",
      status: 401,
    }
  }

  if (siweMessage.notBefore && siweMessage.notBefore > new Date()) {
    return {
      error: "Predicate gate: SIWE message not yet valid",
      status: 401,
    }
  }

  try {
    const valid = await publicClient.verifySiweMessage({
      message: messageStr,
      signature,
      domain: requestDomain,
    })
    if (!valid) {
      return {
        error: "Predicate gate: invalid SIWE signature",
        status: 401,
      }
    }
  } catch {
    return {
      error: "Predicate gate: invalid SIWE signature",
      status: 401,
    }
  }

  const recoveredAddress = siweMessage.address
  if (!recoveredAddress) {
    return {
      error: "Predicate gate: invalid SIWE signature",
      status: 401,
    }
  }

  return { address: recoveredAddress, status: 200 }
}
