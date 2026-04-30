import type { PricingEntry } from "../manifest/types.js"
import type { GateMiddleware, ToolContext } from "../../types.js"

export interface X402GateConfig {
  pricing: PricingEntry[]
  /**
   * Callback to verify an x402 payment proof header.
   * Must return true if the payment is valid. If omitted, the gate
   * rejects all requests that include an X-Payment header with a
   * 501 "payment verification not configured" error.
   */
  verifyPayment?: (paymentHeader: string) => Promise<boolean>
}

export function x402Gate(config: X402GateConfig): GateMiddleware {
  return {
    async check(
      request: Request,
      ctx: Partial<ToolContext>,
    ): Promise<Response | null> {
      const paymentHeader = request.headers.get("X-Payment")

      if (!paymentHeader) {
        return new Response(
          JSON.stringify({
            error: "Payment required",
            requirements: config.pricing,
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json",
              "X-Payment-Requirements": JSON.stringify(
                config.pricing,
              ),
              "X-Accept-Payment": "x402",
            },
          },
        )
      }

      if (!config.verifyPayment) {
        return Response.json(
          { error: "Payment verification not configured" },
          { status: 501 },
        )
      }

      const valid = await config.verifyPayment(paymentHeader)
      if (!valid) {
        return Response.json(
          { error: "Invalid payment proof" },
          { status: 402 },
        )
      }

      if (ctx.gates) {
        ctx.gates.x402 = { paid: true }
      }
      return null
    },
  }
}
