import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { toolHandler } from "../src/handler.js"

const handler = toVercelHandler(toolHandler)

// Raise the function timeout above Vercel's 10s Hobby default. Tools that call
// an LLM or other slow upstream can exceed 10s, which returns a 502 to the
// caller. Worse, x402 settlement runs after your handler succeeds, so a kill
// in the settle/report window can charge the caller without returning a result.
// 60s is the Hobby maximum and is valid on Pro/Enterprise too. Lower it if your
// tool is fast, or raise it on paid plans.
export const maxDuration = 60

export default function (req: VercelRequest, res: VercelResponse) {
  return handler(req, res)
}
