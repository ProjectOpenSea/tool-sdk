// To paywall this tool, use defineToolPaywall — it returns both `pricing`
// (for the manifest) and `gate` (for the handler) from a single config,
// preventing accidental drift between the advertised price and the enforced
// charge.
//
// For lower-level control, use payaiX402Gate / cdpX402Gate directly:
// import { payaiX402Gate } from "@opensea/tool-sdk"
// import { cdpX402Gate } from "@opensea/tool-sdk"
import type { ToolHandlerConfig } from "@opensea/tool-sdk"
import { z } from "zod/v4"
import { manifest } from "./manifest.js"

const InputSchema = z.object({
  query: z.string(),
})

const OutputSchema = z.object({
  result: z.string(),
})

// TODO: Replace this echo handler with your tool logic
export const toolConfig: Omit<
  ToolHandlerConfig<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>>,
  "env"
> = {
  manifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  // gates: [paywall.gate],
  handler: async input => {
    return { result: `Echo: ${input.query}` }
  },
}
