import { describe, expect, it } from "vitest"
import { assembleMarkdown, GUARDRAILS_BLOCK } from "../markdown.js"
import type { Personality, WalletDigest } from "../schemas.js"

const personality: Personality = {
  archetype: "Slow-cook collector. Goes deep on a small set of collections.",
  vibe: "Patient, opinionated, low-key.",
  voice: "Short sentences. Lowercase. Dry observations.",
  taste: "Keeps coming back to a handful of collections rather than spraying.",
  tradingPhilosophy:
    "Buys floors when sentiment cracks. Holds for months. Lists rarely.",
  signatureBehaviors: [
    "Holds top positions continuously for over a year",
    "Lists tokens at 1.7-2x floor when listing at all",
  ],
  signaturePhrases: ["this is fine", "long stays intact"],
  formativeLore: [
    {
      event: "Held a top position through a 60% drawdown",
      impact: "Treats long positions with weight",
    },
  ],
  currentChapter:
    "Last 90 days have been quiet. Two floor sweeps on its top position. Net buyer.",
  doList: [
    "Speak in short, observational sentences.",
    "Reference specific collections by name when context calls for it.",
  ],
  dontList: [
    "Recommend trades.",
    "Reveal ENS, social handles, or real-name identifiers.",
  ],
}

const digest: WalletDigest = {
  address: "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
  ens: "wallet.eth",
  profileName: "wallet",
  snapshot: {
    distinctCollectionCount: 12,
    topCollections: [],
    tokenSplit: { ethEthEquivalent: 0, stablesUsd: 0, otherUsd: 0 },
  },
  activity90d: {
    tradeCount: 4,
    buySellRatio: 2.0,
    mintParticipation: 1,
    listingCadence: {
      activeListings: 0,
      listingsPlaced: 2,
      listingsCancelled: 0,
    },
    distinctCollectionsTraded: 2,
    timeOfDayHistogram: new Array<number>(24).fill(0),
    medianHoldOnFlippedTokensDays: null,
  },
  formative: { biggestWin: null, biggestLoss: null, longestHold: null },
}

describe("assembleMarkdown", () => {
  it("produces a stable, ordered document with the guardrails block", () => {
    const md = assembleMarkdown(personality, digest, "2026-04-29T12:00:00Z")
    expect(md).toMatchSnapshot()
  })

  it("uses ENS in the metadata line when present", () => {
    const md = assembleMarkdown(personality, digest, "2026-04-29T12:00:00Z")
    expect(md).toContain("(wallet.eth)")
  })

  it("falls back to a short address when ENS is null", () => {
    const md = assembleMarkdown(
      personality,
      { ...digest, ens: null },
      "2026-04-29T12:00:00Z",
    )
    expect(md).toContain("(0x5ECA…E2a8)")
  })

  it("appends the constant guardrails block verbatim", () => {
    const md = assembleMarkdown(personality, digest, "2026-04-29T12:00:00Z")
    expect(md).toContain(GUARDRAILS_BLOCK.trim())
  })

  it("emits sections in the exact specified order", () => {
    const md = assembleMarkdown(personality, digest, "2026-04-29T12:00:00Z")
    const expectedOrder = [
      "## Archetype",
      "## Vibe",
      "## Voice",
      "## Taste",
      "## Trading Philosophy",
      "## Signature Behaviors",
      "## Signature Phrases",
      "## Formative Lore",
      "## Current Chapter",
      "## Do",
      "## Don't",
      "## Guardrails",
    ]
    let cursor = 0
    for (const heading of expectedOrder) {
      const at = md.indexOf(heading, cursor)
      expect(at, `${heading} appears in order`).toBeGreaterThanOrEqual(0)
      cursor = at + heading.length
    }
  })
})
