import { createPublicClient, http } from "viem"
import { base } from "viem/chains"
import { parseSiweMessage } from "viem/siwe"
import type { GateMiddleware, ToolContext } from "../../types.js"

export interface NFTGateConfig {
  collection: `0x${string}`
  rpcUrl?: string
}

/**
 * Stateless SIWE gate that re-implements ERC-721 ownership checks
 * off-chain against a single hardcoded collection address.
 *
 * @deprecated Prefer {@link predicateGate} for any tool registered against
 * the canonical `ToolRegistry`. `predicateGate` delegates the access decision
 * to `IToolRegistry.tryHasAccess`, which means:
 *
 * - The onchain registry is the single source of truth for access policy.
 *   If a creator updates the predicate via `setAccessPredicate`, the gate
 *   picks up the new policy automatically.
 * - One middleware works for every predicate type (single-collection ERC-721,
 *   multi-collection, ERC-1155, subscriptions, composites, future predicates).
 *   Callers do not need to ship parallel off-chain re-implementations.
 * - The wallet-side policy and the endpoint-side policy cannot drift.
 *
 * `nftGate` remains useful for local development and unregistered tools where
 * you do not yet have a `toolId`. For registered tools, migrate to
 * `predicateGate({ toolId })`.
 *
 * Stateless SIWE: does not track nonces. Callers should use short-lived
 * `expirationTime` in their SIWE messages to limit replay.
 */

const ERC721_BALANCE_ABI = [
  {
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const

export function nftGate(config: NFTGateConfig): GateMiddleware {
  const client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl ?? "https://mainnet.base.org"),
  })

  return {
    async check(
      request: Request,
      ctx: Partial<ToolContext>,
    ): Promise<Response | null> {
      const authHeader = request.headers.get("Authorization")
      if (!authHeader || !authHeader.startsWith("SIWE ")) {
        return Response.json(
          {
            error: "NFT gate: SIWE authorization required",
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
            error: "NFT gate: SIWE authorization required",
            hint: "Include Authorization: SIWE <base64url(message)>.<signature>",
          },
          { status: 401 },
        )
      }

      const messageB64 = token.slice(0, dotIndex)
      const signatureRaw = token.slice(dotIndex + 1)
      if (!signatureRaw.startsWith("0x")) {
        return Response.json(
          { error: "NFT gate: invalid SIWE signature" },
          { status: 401 },
        )
      }
      const signature = signatureRaw as `0x${string}`

      let messageStr: string
      try {
        messageStr = Buffer.from(messageB64, "base64url").toString(
          "utf-8",
        )
      } catch {
        return Response.json(
          { error: "NFT gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      let siweMessage: ReturnType<typeof parseSiweMessage>
      try {
        siweMessage = parseSiweMessage(messageStr)
      } catch {
        return Response.json(
          { error: "NFT gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      // Enforce domain binding: the SIWE message domain must match this endpoint
      const requestDomain = new URL(request.url).host
      if (siweMessage.domain !== requestDomain) {
        return Response.json(
          { error: "NFT gate: SIWE domain mismatch" },
          { status: 401 },
        )
      }

      // Enforce expiration: reject expired SIWE messages
      if (
        siweMessage.expirationTime &&
        siweMessage.expirationTime < new Date()
      ) {
        return Response.json(
          { error: "NFT gate: SIWE message expired" },
          { status: 401 },
        )
      }

      // Enforce not-before: reject messages used before their valid time
      if (
        siweMessage.notBefore &&
        siweMessage.notBefore > new Date()
      ) {
        return Response.json(
          { error: "NFT gate: SIWE message not yet valid" },
          { status: 401 },
        )
      }

      try {
        const valid = await client.verifySiweMessage({
          message: messageStr,
          signature,
          domain: requestDomain,
        })
        if (!valid) {
          return Response.json(
            { error: "NFT gate: invalid SIWE signature" },
            { status: 401 },
          )
        }
      } catch {
        return Response.json(
          { error: "NFT gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      const recoveredAddress = siweMessage.address
      if (!recoveredAddress) {
        return Response.json(
          { error: "NFT gate: invalid SIWE signature" },
          { status: 401 },
        )
      }

      const balance = await client.readContract({
        address: config.collection,
        abi: ERC721_BALANCE_ABI,
        functionName: "balanceOf",
        args: [recoveredAddress],
      })

      if (balance >= 1n) {
        ctx.callerAddress = recoveredAddress
        if (ctx.gates) {
          ctx.gates.nft = { granted: true }
        }
        return null
      }

      return Response.json(
        {
          error: "NFT gate: insufficient NFT balance",
          required: 1,
          collection: config.collection,
        },
        { status: 403 },
      )
    },
  }
}
