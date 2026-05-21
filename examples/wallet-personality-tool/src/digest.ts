import {
  type AccountEvent,
  type AccountNft,
  type AccountProfile,
  getAccount,
  getAccountEvents,
  getAccountNfts,
  getCollection,
} from "./opensea.js"
import type { WalletDigest } from "./schemas.js"

const CHAINS = ["ethereum", "base"] as const
const SUPPORTED_NFT_CHAINS = CHAINS

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60

// The digest deliberately does not curate collections (no "blue chip"
// list, no per-slug aesthetic tags). The LLM is given the wallet's top
// collections as raw signal and infers archetype/taste from collection
// names, descriptions, holder counts, floor prices, and counts held.
// Forks that want curated signals (e.g. a blue-chip ratio specific to
// their use case) should compute them here from a list they own.

interface SnapshotData {
  distinctCollectionCount: number
  topCollections: WalletDigest["snapshot"]["topCollections"]
  /**
   * `tokenSplit` is best-effort. Without a deep token-balance fan-out the
   * conservative default is all-zero. The LLM is instructed to treat zero
   * splits as "no signal" rather than "wallet has nothing". Plug in a
   * token-balances source to populate it.
   */
  tokenSplit: WalletDigest["snapshot"]["tokenSplit"]
}

async function buildSnapshot(nfts: AccountNft[]): Promise<SnapshotData> {
  const bySlug = new Map<string, number>()
  for (const n of nfts) {
    bySlug.set(n.collection, (bySlug.get(n.collection) ?? 0) + 1)
  }

  const sortedSlugs = [...bySlug.entries()].sort((a, b) => b[1] - a[1])
  const top10 = sortedSlugs.slice(0, 10)

  const collectionStats = await Promise.all(
    top10.map(async ([slug]) => ({
      slug,
      stats: await getCollection(slug).catch(() => null),
    })),
  )

  const topCollections: WalletDigest["snapshot"]["topCollections"] = top10.map(
    ([slug, count]) => {
      const c = collectionStats.find(x => x.slug === slug)?.stats
      return {
        slug,
        name: c?.name ?? slug,
        count,
        floorEth: c?.floorEth ?? null,
        totalSupply: c?.totalSupply ?? null,
        holderCount: c?.numOwners ?? null,
        description: c?.description ?? null,
        chain: c?.chain ?? null,
        createdAtYear: c?.createdAtYear ?? null,
      }
    },
  )

  return {
    distinctCollectionCount: bySlug.size,
    topCollections,
    tokenSplit: { ethEthEquivalent: 0, stablesUsd: 0, otherUsd: 0 },
  }
}

interface ActivityData {
  trade: WalletDigest["activity90d"]
  /** Pass-through for use in formative-trade calculations. */
  saleEvents: AccountEvent[]
  /** Transfer events into the wallet, used to find longest-held token. */
  inboundTransfers: AccountEvent[]
}

function lower(addr?: string): string | undefined {
  return addr ? addr.toLowerCase() : undefined
}

function buildActivity90d(
  address: string,
  events: AccountEvent[],
  nowUnix: number,
): ActivityData {
  const me = address.toLowerCase()
  const cutoff = nowUnix - NINETY_DAYS_SECONDS

  const sales90d = events.filter(
    e => e.eventType === "sale" && e.eventTimestamp >= cutoff,
  )
  const buys = sales90d.filter(e => lower(e.toAddress) === me)
  const sells = sales90d.filter(e => lower(e.fromAddress) === me)

  const buySellRatio = (() => {
    if (sells.length === 0) return buys.length > 0 ? 5.0 : 0
    const r = buys.length / sells.length
    return Math.min(r, 5.0)
  })()

  const mints90d = events.filter(
    e =>
      e.eventType === "mint" &&
      e.eventTimestamp >= cutoff &&
      lower(e.toAddress) === me,
  )

  const listings90d = events.filter(
    e =>
      e.eventType === "listing" &&
      e.eventTimestamp >= cutoff &&
      lower(e.fromAddress) === me,
  )

  // Histogram of UTC hours, 24 buckets. Includes any 90d activity (sale,
  // transfer, listing, mint) where the wallet is on the active side. The
  // LLM uses cadence shape, not absolute counts, so the mix of event
  // types is fine.
  const hist = new Array<number>(24).fill(0)
  const within90d = events.filter(e => e.eventTimestamp >= cutoff)
  for (const e of within90d) {
    const involved = lower(e.toAddress) === me || lower(e.fromAddress) === me
    if (!involved) continue
    const hourUtc = new Date(e.eventTimestamp * 1000).getUTCHours()
    hist[hourUtc] += 1
  }

  // Median hold on flipped tokens: tokens this wallet bought AND sold
  // within the 90d window. For each (collection, tokenId) compute
  // (sell_ts - buy_ts), then take the median across pairs. Skip tokens
  // with multiple buys/sells to keep math simple.
  const flipKeys = new Map<string, { buyTs?: number; sellTs?: number }>()
  for (const e of sales90d) {
    if (!e.contract || !e.tokenId) continue
    const key = `${e.contract}:${e.tokenId}`
    const slot = flipKeys.get(key) ?? {}
    if (lower(e.toAddress) === me) slot.buyTs = e.eventTimestamp
    if (lower(e.fromAddress) === me) slot.sellTs = e.eventTimestamp
    flipKeys.set(key, slot)
  }
  const holdSpans = [...flipKeys.values()]
    .filter(v => v.buyTs && v.sellTs && v.sellTs > v.buyTs)
    .map(v => (v.sellTs as number) - (v.buyTs as number))
    .sort((a, b) => a - b)
  const medianHoldDays =
    holdSpans.length === 0
      ? null
      : Math.round(holdSpans[Math.floor(holdSpans.length / 2)] / 86400)

  // Distinct collections traded (buyer or seller) in 90d.
  const distinctCollections = new Set<string>()
  for (const e of sales90d) {
    if (e.collectionSlug) distinctCollections.add(e.collectionSlug)
  }

  return {
    trade: {
      tradeCount: sales90d.length,
      buySellRatio,
      mintParticipation: mints90d.length,
      listingCadence: {
        // Active-listing count is not derivable from REST events alone
        // (the listings endpoint is paginated separately); leave at 0.
        activeListings: 0,
        listingsPlaced: listings90d.length,
        listingsCancelled: 0,
      },
      distinctCollectionsTraded: distinctCollections.size,
      timeOfDayHistogram: hist,
      medianHoldOnFlippedTokensDays: medianHoldDays,
    },
    saleEvents: events.filter(e => e.eventType === "sale"),
    inboundTransfers: events.filter(
      e => e.eventType === "transfer" && lower(e.toAddress) === me,
    ),
  }
}

interface FormativeData {
  formative: WalletDigest["formative"]
}

function buildFormative(
  address: string,
  allSales: AccountEvent[],
  inboundTransfers: AccountEvent[],
  currentHoldings: AccountNft[],
  nowUnix: number,
): FormativeData {
  const me = address.toLowerCase()

  // Group sales per token (contract:tokenId) so we can reconstruct the
  // most recent acquisition price before each outbound sale.
  const salesByToken = new Map<string, AccountEvent[]>()
  for (const e of allSales) {
    if (!e.contract || !e.tokenId) continue
    const key = `${e.contract}:${e.tokenId}`
    const arr = salesByToken.get(key) ?? []
    arr.push(e)
    salesByToken.set(key, arr)
  }

  let biggestWin: WalletDigest["formative"]["biggestWin"] = null
  let biggestLoss: WalletDigest["formative"]["biggestLoss"] = null

  for (const [, events] of salesByToken) {
    // Sort by time ascending so the i-th outbound sale follows any prior
    // inbound buys / transfers chronologically.
    const sorted = [...events].sort(
      (a, b) => a.eventTimestamp - b.eventTimestamp,
    )
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]
      if (lower(e.fromAddress) !== me) continue
      const exitEth = e.ethValue
      if (typeof exitEth !== "number") continue

      // Find the most recent prior buy by this wallet of the same token.
      let entry: AccountEvent | undefined
      for (let j = i - 1; j >= 0; j--) {
        const prev = sorted[j]
        if (lower(prev.toAddress) === me && typeof prev.ethValue === "number") {
          entry = prev
          break
        }
      }
      if (!entry || typeof entry.ethValue !== "number") continue

      const profit = exitEth - entry.ethValue
      const holdDays = Math.max(
        0,
        Math.round((e.eventTimestamp - entry.eventTimestamp) / 86400),
      )
      const exitDate = new Date(e.eventTimestamp * 1000).toISOString()

      if (profit > 0 && (!biggestWin || profit > biggestWin.profitEth)) {
        biggestWin = {
          collectionSlug: e.collectionSlug ?? "unknown",
          tokenId: e.tokenId ?? "0",
          entryEth: entry.ethValue,
          exitEth,
          profitEth: profit,
          holdDays,
          exitDate,
        }
      }
      if (profit < 0 && (!biggestLoss || profit < -biggestLoss.lossEth)) {
        biggestLoss = {
          collectionSlug: e.collectionSlug ?? "unknown",
          tokenId: e.tokenId ?? "0",
          entryEth: entry.ethValue,
          exitEth,
          lossEth: -profit,
          holdDays,
          exitDate,
        }
      }
    }
  }

  // Longest-currently-held: walk inbound transfers (any time horizon),
  // filter to tokens the wallet still holds, oldest acquisition wins.
  const heldKeys = new Set(
    currentHoldings.map(n => `${n.contract.toLowerCase()}:${n.identifier}`),
  )
  const candidates = inboundTransfers
    .filter(t => t.contract && t.tokenId)
    .filter(t =>
      heldKeys.has(`${(t.contract as string).toLowerCase()}:${t.tokenId}`),
    )
    .sort((a, b) => a.eventTimestamp - b.eventTimestamp)

  let longestHold: WalletDigest["formative"]["longestHold"] = null
  if (candidates.length > 0) {
    const t = candidates[0]
    longestHold = {
      collectionSlug: t.collectionSlug ?? "unknown",
      tokenId: t.tokenId ?? "0",
      acquiredAt: new Date(t.eventTimestamp * 1000).toISOString(),
      holdDaysSoFar: Math.max(
        0,
        Math.round((nowUnix - t.eventTimestamp) / 86400),
      ),
    }
  }

  return { formative: { biggestWin, biggestLoss, longestHold } }
}

export interface BuildDigestOptions {
  /** UNIX seconds; defaults to `Date.now() / 1000`. Injectable for tests. */
  now?: number
}

/**
 * Run all three passes and aggregate. Pure function once `getAccount`,
 * `getAccountNfts`, and `getAccountEvents` are stubbed; safe to unit-test
 * with synthesized fixtures.
 */
export async function buildWalletDigest(
  address: string,
  opts: BuildDigestOptions = {},
): Promise<WalletDigest> {
  const nowUnix = opts.now ?? Math.floor(Date.now() / 1000)
  const cutoff = nowUnix - NINETY_DAYS_SECONDS

  // Pass A inputs (parallel).
  const profilePromise: Promise<AccountProfile> = getAccount(address).catch(
    () =>
      ({
        address,
        username: null,
        ens: null,
        bannerImageUrl: null,
        profileImageUrl: null,
      }) satisfies AccountProfile,
  )
  const nftsPromise = Promise.all(
    SUPPORTED_NFT_CHAINS.map(c => getAccountNfts(c, address).catch(() => [])),
  ).then(arrays => arrays.flat())

  // Pass B inputs: 90d of sale + transfer + listing + mint events.
  const events90dPromise = getAccountEvents(address, {
    eventTypes: ["sale", "transfer", "listing", "mint"],
    afterUnix: cutoff,
  }).catch(() => [] as AccountEvent[])

  // Pass C inputs: all-time sales + transfers, capped by maxPages.
  // Used for biggest win/loss/longest-hold computations.
  const eventsAllTimePromise = getAccountEvents(address, {
    eventTypes: ["sale", "transfer"],
    maxPages: 10,
  }).catch(() => [] as AccountEvent[])

  const [profile, nfts, events90d, eventsAllTime] = await Promise.all([
    profilePromise,
    nftsPromise,
    events90dPromise,
    eventsAllTimePromise,
  ])

  const snapshot = await buildSnapshot(nfts)
  const activity = buildActivity90d(address, events90d, nowUnix)
  // For formative, prefer the all-time fetch but fall back to 90d if the
  // all-time call failed.
  const formativeSource =
    eventsAllTime.length >= events90d.length ? eventsAllTime : events90d
  const allSales = formativeSource.filter(e => e.eventType === "sale")
  const inboundTransfers = formativeSource.filter(
    e =>
      e.eventType === "transfer" &&
      lower(e.toAddress) === address.toLowerCase(),
  )
  const formative = buildFormative(
    address,
    allSales,
    inboundTransfers,
    nfts,
    nowUnix,
  )

  return {
    address,
    ens: profile.ens,
    profileName: profile.username,
    snapshot: {
      distinctCollectionCount: snapshot.distinctCollectionCount,
      topCollections: snapshot.topCollections,
      tokenSplit: snapshot.tokenSplit,
    },
    activity90d: activity.trade,
    formative: formative.formative,
  }
}
