import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, jsonSchema } from "ai"
import { renderDigest, SYSTEM_PROMPT } from "./prompts.js"
import {
  type Personality,
  PersonalitySchema,
  personalityJsonSchema,
  type WalletDigest,
} from "./schemas.js"

const DEFAULT_MODEL = "claude-haiku-4-5"

export interface SynthesizePersonalityOptions {
  /** Override the model. Falls back to env, then DEFAULT_MODEL. */
  model?: string
  /** Override the API key. Falls back to ANTHROPIC_API_KEY. */
  apiKey?: string
}

/**
 * Run the LLM against the digest, validating the result against
 * `PersonalitySchema`. Two attempts: the first relies on `generateObject`'s
 * built-in retry on schema mismatch; the second is our explicit retry if
 * the model returns something the JSON schema accepts but the zod
 * validator rejects (e.g. an over-length string).
 *
 * Failures after the second attempt throw — the caller maps to a 502.
 */
export async function synthesizePersonality(
  digest: WalletDigest,
  opts: SynthesizePersonalityOptions = {},
): Promise<Personality> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY env var is not set. Set it in .env.local for `vercel dev` or in the Vercel project for deploy.",
    )
  }
  const modelId =
    opts.model ?? process.env.WALLET_PERSONALITY_MODEL ?? DEFAULT_MODEL
  const provider = createAnthropic({ apiKey })
  const model = provider(modelId)

  const userContent = renderDigest(digest)

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateObject({
      model,
      schema: jsonSchema<Personality>(personalityJsonSchema),
      schemaName: "WalletPersonality",
      schemaDescription:
        "Persona derived from a wallet's onchain history. Used as a system prompt by downstream agents.",
      // temperature 0.3: enough variance for voice / phrases to feel
      // distinctive across wallets, low enough that signal-to-section
      // mapping stays stable.
      temperature: 0.3,
      // Bounds the worst-case output and keeps Haiku-class models from
      // running long on this schema. The realistic ceiling for a fully
      // populated PersonalitySchema is ~3K tokens; 4K leaves headroom.
      maxTokens: 4000,
      maxRetries: 2,
      // Cache control sits on the static system prompt (constant across
      // all callers), not on the per-wallet user message. The user
      // message is unique every call and would never produce a cache
      // hit; the ~800-token system block is the natural caching target.
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    })

    const parsed = PersonalitySchema.safeParse(result.object)
    if (parsed.success) return parsed.data
    if (attempt === 1) {
      throw new Error(
        `LLM output failed schema validation after retry: ${parsed.error.message}`,
      )
    }
  }
  throw new Error("unreachable")
}
