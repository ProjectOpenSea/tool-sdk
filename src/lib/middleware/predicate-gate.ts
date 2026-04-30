import { type Chain, createPublicClient, http } from "viem"
import { base } from "viem/chains"
import { parseSiweMessage } from "viem/siwe"
import type { GateMiddleware, ToolContext } from "../../types.js"
import { ToolRegistryClient } from "../onchain/registry.js"

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
}

/**
 * Server-side gate that delegates access decisions to the onchain
 * `ToolRegistry`. Verifies SIWE auth, recovers the caller's address, and
 * staticcalls `tryHasAccess(toolId, caller, data)` on the registry.
 *
 * - `(ok=true, granted=true)`: gate passes; sets `ctx.callerAddress`.
 * - `(ok=true, granted=false)`: returns `403` with the registered predicate
 *   address in the body so the caller can self-diagnose.
 * - `(ok=false, *)`: returns `502` (predicate misbehaved upstream).
 *
 * Stateless SIWE: does not track nonces. Callers should use short-lived
 * `expirationTime` in their SIWE messages to limit replay.
 *
 * Prefer this over `nftGate` for any tool registered with an `accessPredicate`.
 * The registry is the source of truth for access policy; this middleware just
 * consults it.
 */
export function predicateGate(config: PredicateGateConfig): GateMiddleware {
  const chain = config.chain ?? base
  const rpcUrl = config.rpcUrl ?? "https://mainnet.base.org"

  const siweClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const registry = new ToolRegistryClient({ chain, rpcUrl })

  /**
   * Lifetime of the cached predicate address used in 403 bodies. Short enough
   * that `setAccessPredicate` updates surface in self-diagnosing 403 responses
   * within minutes; long enough to avoid hammering the registry on every
   * denial.
   */
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
        .then(c => {
          cached = { address: c.accessPredicate, fetchedAt: Date.now() }
          inflight = null
          return c.accessPredicate
        })
        .catch(err => {
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
      if (!authHeader || !authHeader.startsWith("SIWE ")) {
        return Response.json(
          {
            error: "Predicate gate: SIWE authorization required",
            hint: "Include Authorization: SIWE <base64url(message)>.<signature>",
          },
          { status: 401 },
        )
      }

      const token = authHeader.slice(5)
      const dotIndex = token.lastIndexOf(".")
      if (dotIndex === -1) {
        return Response.json(
          {
            error: "Predicate gate: SIWE authorization required",
            hint: "Include Authorization: SIWE <base64url(message)>.<signature>",
          },
          { status: 401 },
        )
      }

      const messageB64 = token.slice(0, dotIndex)
      const signatureRaw = token.slice(dotIndex + 1)
      if (!signatureRaw.startsWith("0x")) {
        return Response.json(
          { error: "Predicate gate: invalid SIWE signature" },
          { status: 401 },
        )
      }
      const signature = signatureRaw as `0x${string}`

      let messageStr: string
      try {
        messageStr = Buffer.from(messageB64, "base64url").toString("utf-8")
      } catch {
        return Response.json(
          { error: "Predicate gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      let siweMessage: ReturnType<typeof parseSiweMessage>
      try {
        siweMessage = parseSiweMessage(messageStr)
      } catch {
        return Response.json(
          { error: "Predicate gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      const requestDomain = new URL(request.url).host
      if (siweMessage.domain !== requestDomain) {
        return Response.json(
          { error: "Predicate gate: SIWE domain mismatch" },
          { status: 401 },
        )
      }

      if (
        siweMessage.expirationTime &&
        siweMessage.expirationTime < new Date()
      ) {
        return Response.json(
          { error: "Predicate gate: SIWE message expired" },
          { status: 401 },
        )
      }

      if (siweMessage.notBefore && siweMessage.notBefore > new Date()) {
        return Response.json(
          { error: "Predicate gate: SIWE message not yet valid" },
          { status: 401 },
        )
      }

      try {
        const valid = await siweClient.verifySiweMessage({
          message: messageStr,
          signature,
          domain: requestDomain,
        })
        if (!valid) {
          return Response.json(
            { error: "Predicate gate: invalid SIWE signature" },
            { status: 401 },
          )
        }
      } catch {
        return Response.json(
          { error: "Predicate gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      const recoveredAddress = siweMessage.address
      if (!recoveredAddress) {
        return Response.json(
          { error: "Predicate gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      const data = config.data ?? "0x"
      let result: { ok: boolean; granted: boolean }
      try {
        result = await registry.tryHasAccess(
          config.toolId,
          recoveredAddress,
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

      ctx.callerAddress = recoveredAddress
      if (ctx.gates) {
        ctx.gates.predicate = { granted: true }
      }
      return null
    },
  }
}
