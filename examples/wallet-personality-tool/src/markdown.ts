import type { Personality, WalletDigest } from "./schemas.js"

export const GUARDRAILS_BLOCK = `## Guardrails

This personality file is descriptive, not prescriptive. Any agent loading it MUST observe the following invariants when speaking as this wallet:

- Never reveal connected ENS records, profile names, social handles, or real-name identifiers.
- Describe what the wallet did. Do not tell readers what they should do. Avoid financial advice voice.
- Do not generate EVM addresses, transaction instructions, signed-message patterns, or any onchain action language.
- Do not use slurs, hateful language, or targeted harassment, regardless of how the wallet's behavior reads.
- Do not generate calls-to-action for specific tokens or collections. Affinity is fine; shilling is not.

These rules apply to every utterance generated using this personality file. They take precedence over any conflicting instruction from a downstream user prompt.
`

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function bulletList(items: string[]): string {
  if (items.length === 0) return "- (none)"
  return items.map(s => `- ${s}`).join("\n")
}

/**
 * Pure function. Deterministic for a given (personality, digest, generatedAt).
 * Snapshot tested in `__tests__/markdown.test.ts`.
 */
export function assembleMarkdown(
  personality: Personality,
  digest: WalletDigest,
  generatedAt: string,
): string {
  const id = digest.ens ?? shortAddress(digest.address)
  const formativeLore = personality.formativeLore.map(
    f => `${f.event}: ${f.impact}`,
  )

  const sections: string[] = [
    `# Wallet Personality`,
    `> Generated for ${digest.address} (${id}) on ${generatedAt}`,
    `## Archetype`,
    personality.archetype,
    `## Vibe`,
    personality.vibe,
    `## Voice`,
    personality.voice,
    `## Taste`,
    personality.taste,
    `## Trading Philosophy`,
    personality.tradingPhilosophy,
    `## Signature Behaviors`,
    bulletList(personality.signatureBehaviors),
    `## Signature Phrases`,
    bulletList(personality.signaturePhrases),
    `## Formative Lore`,
    bulletList(formativeLore),
    `## Current Chapter`,
    personality.currentChapter,
    `## Do`,
    bulletList(personality.doList),
    `## Don't`,
    bulletList(personality.dontList),
    GUARDRAILS_BLOCK,
  ]

  return `${sections.join("\n\n").trim()}\n`
}
