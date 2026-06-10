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
  CDP_X402_FACILITATOR_URL,
  PAYAI_X402_FACILITATOR_URL,
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
  type X402Network,
} from "../middleware/x402-facilitators.js"
import { IDelegateRegistryABI } from "../onchain/abis.js"
import { DELEGATE_REGISTRY } from "../onchain/chains.js"
import { ToolRegistryClient } from "../onchain/registry.js"
import type { ZeroValueAuthorization } from "../usage/eip3009-auth.js"

const NETWORK_USDC: Record<number, `0x${string}`> = {
  8453: USDC_BASE_ADDRESS as `0x${string}`,
  84532: USDC_BASE_SEPOLIA_ADDRESS as `0x${string}`,
}

const X402_NETWORK_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
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
      const paymentHeader = request.headers.get("X-Payment")
      const authHeader = request.headers.get("Authorization")

      let recoveredAddress: `0x${string}` | null = null
      let callerAuthorization: ZeroValueAuthorization | undefined

      if (paymentHeader) {
        const result = await verifyXPaymentAuth(paymentHeader, config)
        if (result.error) {
          return Response.json(
            { error: result.error },
            { status: result.status },
          )
        }
        recoveredAddress = result.address!
        callerAuthorization = result.authorization
      } else if (authHeader?.startsWith("EIP-3009 ")) {
        const result = await verifyEip3009Auth(authHeader, config, chain)
        if (result.error) {
          if (config.operatorAddress && result.toMismatch) {
            return buildPredicateChallengeResponse(config.operatorAddress, chain.id)
          }
          return Response.json(
            { error: result.error },
            { status: result.status },
          )
        }
        recoveredAddress = result.address!
        callerAuthorization = result.authorization
      } else if (authHeader?.startsWith("SIWE ")) {
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
      } else if (config.operatorAddress) {
        return buildPredicateChallengeResponse(config.operatorAddress, chain.id)
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
  /** Set when EIP-3009 `to` field does not match the configured operator. */
  toMismatch?: boolean
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
      toMismatch: true,
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
// X-Payment verification (unified x402 flow for free + paid tools)
// ---------------------------------------------------------------------------

async function verifyXPaymentAuth(
  paymentHeader: string,
  config: Pick<PredicateGateConfig, "operatorAddress">,
): Promise<AuthResult> {
  let decoded: string
  try {
    decoded = Buffer.from(paymentHeader, "base64").toString("utf-8")
  } catch {
    return {
      error: "Predicate gate: invalid X-Payment header (bad base64)",
      status: 401,
    }
  }

  let paymentPayload: {
    x402Version?: number
    network?: string
    payload?: {
      signature?: string
      authorization?: Record<string, string>
    }
  }
  try {
    paymentPayload = JSON.parse(decoded)
  } catch {
    return {
      error: "Predicate gate: invalid X-Payment header (bad JSON)",
      status: 401,
    }
  }

  if (paymentPayload.x402Version !== undefined && paymentPayload.x402Version !== 1) {
    return {
      error: `Predicate gate: unsupported x402 version ${paymentPayload.x402Version}`,
      status: 400,
    }
  }

  const auth = paymentPayload.payload?.authorization
  const signature = paymentPayload.payload?.signature

  if (!auth?.from || !auth?.to || !signature || !auth?.nonce || !auth?.validBefore) {
    return {
      error:
        "Predicate gate: X-Payment missing required authorization fields",
      status: 401,
    }
  }

  if (
    config.operatorAddress &&
    auth.to.toLowerCase() !== config.operatorAddress.toLowerCase()
  ) {
    return {
      error: `Predicate gate: X-Payment 'to' address mismatch (expected ${config.operatorAddress})`,
      status: 401,
    }
  }

  const network = paymentPayload.network ?? "base"
  const chainId = X402_NETWORK_CHAIN_IDS[network]
  if (chainId === undefined) {
    return {
      error: `Predicate gate: unsupported network '${network}' in X-Payment`,
      status: 401,
    }
  }

  const tokenAddress = NETWORK_USDC[chainId]
  if (!tokenAddress) {
    return {
      error: `Predicate gate: no USDC address for chainId ${chainId}`,
      status: 401,
    }
  }

  if (auth.validBefore !== undefined) {
    const validBefore = BigInt(auth.validBefore)
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    if (nowSec >= validBefore) {
      return {
        error: "Predicate gate: X-Payment authorization expired",
        status: 401,
      }
    }
  }

  if (auth.validAfter !== undefined && auth.validAfter !== "0") {
    const validAfter = BigInt(auth.validAfter)
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    if (nowSec < validAfter) {
      return {
        error: "Predicate gate: X-Payment authorization not yet valid",
        status: 401,
      }
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
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value ?? "0"),
        validAfter: BigInt(auth.validAfter ?? "0"),
        validBefore: BigInt(auth.validBefore ?? "0"),
        nonce: auth.nonce as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    })
  } catch {
    return {
      error: "Predicate gate: invalid X-Payment signature",
      status: 401,
    }
  }

  if (recoveredAddress.toLowerCase() !== auth.from.toLowerCase()) {
    return {
      error:
        "Predicate gate: X-Payment signer does not match 'from' address",
      status: 401,
    }
  }

  const authorization: ZeroValueAuthorization | undefined =
    auth.value === "0"
      ? {
          signature: signature as `0x${string}`,
          from: auth.from as `0x${string}`,
          to: auth.to as `0x${string}`,
          value: "0",
          validAfter: auth.validAfter ?? "0",
          validBefore: auth.validBefore ?? "0",
          nonce: auth.nonce as `0x${string}`,
          chainId,
        }
      : undefined

  return { address: recoveredAddress, authorization, status: 200 }
}

const CHAIN_ID_TO_NETWORK: Record<number, string> = {
  8453: "base",
  84532: "base-sepolia",
}

function buildPredicateChallengeResponse(
  operatorAddress: `0x${string}`,
  chainId: number,
): Response {
  const network = CHAIN_ID_TO_NETWORK[chainId] ?? "base"
  const asset = NETWORK_USDC[chainId] ?? USDC_BASE_ADDRESS
  return Response.json(
    {
      x402Version: 1,
      error: "Predicate gate: X-PAYMENT header is required",
      accepts: [
        {
          scheme: "exact",
          network,
          maxAmountRequired: "0",
          payTo: operatorAddress,
          asset,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    },
    {
      status: 402,
      headers: { "X-Accept-Payment": "x402" },
    },
  )
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

// ---------------------------------------------------------------------------
// Combined paid + predicate gate (single 402 round trip)
// ---------------------------------------------------------------------------

const USDC_DECIMALS = 6

const NETWORK_USDC_BY_NAME: Record<string, string> = {
  base: USDC_BASE_ADDRESS,
  "base-sepolia": USDC_BASE_SEPOLIA_ADDRESS,
}

/**
 * Hard timeout for facilitator HTTP calls (both /verify and /settle).
 */
const FACILITATOR_TIMEOUT_MS = 10_000

export interface PaidPredicateGateConfig {
  /**
   * Onchain tool ID from the `ToolRegistered` event.
   */
  toolId: bigint
  /**
   * Chain where the registry is deployed. Defaults to Base.
   */
  chain?: Chain
  /**
   * RPC URL for read calls. Defaults to the chain's public RPC.
   */
  rpcUrl?: string
  /**
   * Optional bytes forwarded as the `data` argument to the predicate.
   */
  data?: `0x${string}`
  /**
   * Override the canonical registry address.
   */
  registryAddress?: `0x${string}`
  /**
   * Override the delegate.xyz DelegateRegistry address.
   */
  delegateRegistryAddress?: `0x${string}`
  /**
   * Tool operator address. Used as both:
   * - The identity binding (`to` field in X-Payment must match)
   * - The payment recipient (`payTo` in the 402 challenge)
   */
  operatorAddress: `0x${string}`
  /**
   * USDC amount as a decimal string ("0.01") or in 6-decimal base units
   * ("10000"). Disambiguated by the presence of a decimal point.
   */
  amountUsdc: string
  /**
   * Network for x402 payment. Defaults to "base".
   */
  network?: X402Network
  /**
   * Description shown in the PaymentRequirements body.
   */
  description?: string
  /**
   * Maximum time (seconds) the caller has to complete the tool call after
   * the facilitator verifies the payment. Defaults to 60.
   */
  maxTimeoutSeconds?: number
  /**
   * Override the resource URL advertised in the 402 response.
   */
  resource?: string
  /**
   * Which facilitator to use. Defaults to "payai".
   */
  facilitator?: "payai" | "cdp"
  /**
   * Override the facilitator URL.
   */
  facilitatorUrl?: string
  /**
   * Generate auth headers for CDP /verify calls. Required when
   * facilitator is "cdp".
   */
  createAuthHeaders?: () => Promise<Record<string, string>>
}

/**
 * Combined predicate + x402 payment gate that resolves identity proof and
 * payment in a **single 402 round trip**.
 *
 * Instead of requiring two separate 402 challenges (one zero-value for
 * identity, one real-value for payment), this gate advertises the real
 * payment amount in its sole 402 response. The caller's X-Payment signature
 * for the real amount simultaneously proves identity (via the recovered
 * `from` address) AND authorizes payment (via the facilitator).
 *
 * **Flow:**
 * ```
 * POST (bare)             → 402 {payTo: operator, maxAmountRequired: "$"}
 * X-Payment(to=op, val=$) → verify sig → check predicate → verify payment → 200
 * ```
 *
 * **Safety:** The onchain predicate is checked BEFORE the facilitator settles
 * payment. If the caller does not meet the access requirement, a 403 is
 * returned and no funds move.
 */
export function paidPredicateGate(config: PaidPredicateGateConfig): GateMiddleware {
  if (config.facilitator === "cdp" && !config.createAuthHeaders) {
    throw new Error(
      "paidPredicateGate: createAuthHeaders is required when facilitator is 'cdp'",
    )
  }

  const chain = config.chain ?? base
  const rpcUrl = config.rpcUrl ?? "https://mainnet.base.org"
  const network = config.network ?? "base"
  const facilitatorUrl =
    config.facilitatorUrl ??
    (config.facilitator === "cdp"
      ? CDP_X402_FACILITATOR_URL
      : PAYAI_X402_FACILITATOR_URL)
  const maxAmountRequired = toUsdcBaseUnits(config.amountUsdc)
  const description = config.description ?? "Tool invocation"
  const maxTimeoutSeconds = config.maxTimeoutSeconds ?? 60
  const asset = NETWORK_USDC_BY_NAME[network] ?? USDC_BASE_ADDRESS

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
  let cached: { address: `0x${string}`; fetchedAt: number } | null = null
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

  interface PaymentPayload {
    x402Version: number
    scheme: string
    network: string
    payload: unknown
  }

  interface PaymentRequirementsV1 {
    scheme: "exact"
    network: string
    maxAmountRequired: string
    resource: string
    description: string
    mimeType: string
    payTo: string
    maxTimeoutSeconds: number
    asset: string
    extra?: Record<string, unknown>
  }

  // Per-gate-instance stash from check() → settle(). Closure-scoped and
  // keyed by ctx so the user handler cannot tamper with verified payloads.
  const stashedByCtx = new WeakMap<
    Partial<ToolContext>,
    { paymentPayload: PaymentPayload; requirements: PaymentRequirementsV1 }
  >()

  return {
    async check(
      request: Request,
      ctx: Partial<ToolContext>,
    ): Promise<Response | null> {
      const resource = config.resource ?? canonicalResourceUrl(request.url)
      const requirements: PaymentRequirementsV1 = {
        scheme: "exact",
        network,
        maxAmountRequired,
        resource,
        description,
        mimeType: "application/json",
        payTo: config.operatorAddress,
        maxTimeoutSeconds,
        asset,
        extra: { name: "USD Coin", version: "2" },
      }

      const paymentHeader = request.headers.get("X-Payment")

      if (!paymentHeader) {
        return Response.json(
          {
            x402Version: 1,
            error: "Payment and identity required",
            accepts: [requirements],
          },
          {
            status: 402,
            headers: { "X-Accept-Payment": "x402" },
          },
        )
      }

      // --- Identity verification (X-Payment signature) ---
      const authResult = await verifyXPaymentAuth(paymentHeader, {
        operatorAddress: config.operatorAddress,
      })
      if (authResult.error) {
        return Response.json(
          { error: authResult.error },
          { status: authResult.status },
        )
      }

      const recoveredAddress = authResult.address!

      // --- Delegation support ---
      const delegateForRaw = request.headers.get("X-Delegate-For")
      let predicateSubject = recoveredAddress
      let agentAddress: `0x${string}` | undefined

      if (delegateForRaw) {
        const HEX_RE = /^0x[0-9a-fA-F]{40}$/
        if (!HEX_RE.test(delegateForRaw)) {
          return Response.json(
            {
              error:
                "Paid predicate gate: invalid X-Delegate-For header (expected 0x-prefixed address)",
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
            { error: `Paid predicate gate: delegate registry call failed (${reason})` },
            { status: 502 },
          )
        }

        if (!isDelegateValid) {
          return Response.json(
            {
              error:
                "Paid predicate gate: delegate.xyz delegation not found — holder has not delegated to this agent",
              hint: "The holder must delegate to the agent at https://delegate.xyz",
            },
            { status: 403 },
          )
        }

        predicateSubject = holderAddress
        agentAddress = recoveredAddress
      }

      // --- Onchain predicate check (BEFORE payment settlement) ---
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
          { error: `Paid predicate gate: registry call failed (${reason})` },
          { status: 502 },
        )
      }

      if (!result.ok) {
        return Response.json(
          {
            error:
              "Paid predicate gate: predicate misbehaved (registry tryHasAccess returned ok=false)",
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
            error: "Paid predicate gate: access predicate denied",
            toolId: config.toolId.toString(),
            predicate,
          },
          { status: 403 },
        )
      }

      // --- Payment verification via facilitator ---
      let paymentPayload: PaymentPayload
      try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8")
        paymentPayload = JSON.parse(decoded)
      } catch {
        return Response.json(
          { error: "Paid predicate gate: invalid X-Payment payload" },
          { status: 401 },
        )
      }

      let authHeaders: Record<string, string> = {}
      if (config.createAuthHeaders) {
        try {
          authHeaders = await config.createAuthHeaders()
        } catch {
          return Response.json(
            { error: "Payment facilitator unreachable" },
            { status: 502 },
          )
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        FACILITATOR_TIMEOUT_MS,
      )

      let verifyRes: Response
      try {
        verifyRes = await fetch(`${facilitatorUrl}/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            x402Version: paymentPayload.x402Version ?? 1,
            paymentPayload,
            paymentRequirements: requirements,
          }),
          signal: controller.signal,
        })
      } catch {
        return Response.json(
          { error: "Payment facilitator unreachable" },
          { status: 502 },
        )
      } finally {
        clearTimeout(timeoutId)
      }

      if (!verifyRes.ok) {
        return Response.json(
          { error: "Payment facilitator unreachable" },
          { status: 502 },
        )
      }

      const verifyData = (await verifyRes.json()) as {
        isValid?: boolean
        invalidReason?: string
        payer?: string
      }

      if (!verifyData.isValid) {
        return Response.json(
          {
            x402Version: 1,
            error: verifyData.invalidReason ?? "invalid_payment",
            accepts: [requirements],
          },
          { status: 402 },
        )
      }

      // --- Success: set context and stash for settlement ---
      ctx.callerAddress = predicateSubject
      if (agentAddress) {
        ctx.agentAddress = agentAddress
      }
      if (authResult.authorization) {
        ctx.callerAuthorization = authResult.authorization
      }
      if (ctx.gates) {
        ctx.gates.predicate = { granted: true }
        ctx.gates.x402 = { paid: true, payer: verifyData.payer }
      }
      stashedByCtx.set(ctx, { paymentPayload, requirements })
      return null
    },

    async settle(ctx: ToolContext): Promise<void> {
      const stashed = stashedByCtx.get(ctx)
      if (!stashed) return

      let authHeaders: Record<string, string> = {}
      if (config.createAuthHeaders) {
        authHeaders = await config.createAuthHeaders()
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        FACILITATOR_TIMEOUT_MS,
      )

      try {
        const res = await fetch(`${facilitatorUrl}/settle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            x402Version: stashed.paymentPayload.x402Version ?? 1,
            paymentPayload: stashed.paymentPayload,
            paymentRequirements: stashed.requirements,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = (await res.text().catch(() => "<no body>")).slice(0, 256)
          throw new Error(
            `facilitator /settle returned ${res.status}: ${body}`,
          )
        }
        const body = (await res.json()) as {
          success?: boolean
          transaction?: string
          error?: string
          errorReason?: string
          network?: string
        }
        if (!body.success) {
          throw new Error(
            `facilitator /settle reported failure: ${
              body.error ?? body.errorReason ?? "<unknown>"
            }`,
          )
        }
        if (ctx.gates?.x402 && body.transaction) {
          ctx.gates.x402.settlementTxHash = body.transaction
        }
        if (ctx.gates?.x402 && body.network) {
          const chainId = X402_NETWORK_CHAIN_IDS[body.network]
          if (chainId !== undefined) {
            ctx.gates.x402.settlementChainId = chainId
          }
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

function toUsdcBaseUnits(amount: string): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`paidPredicateGate: invalid amountUsdc: ${amount}`)
  }
  if (!amount.includes(".")) {
    return amount
  }
  const [whole, frac = ""] = amount.split(".")
  if (frac.length > USDC_DECIMALS) {
    throw new Error(
      `paidPredicateGate: amountUsdc has more than ${USDC_DECIMALS} decimals: ${amount}`,
    )
  }
  const padded = frac.padEnd(USDC_DECIMALS, "0")
  const result = `${whole}${padded}`.replace(/^0+/, "")
  return result === "" ? "0" : result
}

function canonicalResourceUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ""
  return parsed.toString()
}
