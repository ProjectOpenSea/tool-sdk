const BASE_URL = "https://api.opensea.io/api/v2"

export class OpenSeaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message)
    this.name = "OpenSeaError"
  }
}

export interface CollectionContractRef {
  slug: string
  contract: string
}

export interface CollectionStats {
  slug: string
  name: string
  description?: string
  totalSupply?: number
  floorPrice?: { amount: string; currency: string; usd?: number }
  oneDayVolume?: number
  totalVolume?: number
  numOwners?: number
}

export interface NftDetail {
  identifier: string
  name?: string
  description?: string
  imageUrl?: string
  traits: Array<{
    trait_type: string
    value: string | number
    display_type?: string
  }>
  rarity?: { rank?: number; score?: number }
}

export interface SaleEvent {
  tokenId: string
  eventTimestamp: string
  paymentToken: { symbol: string; decimals: number; usdPrice?: number }
  totalPrice: string
  fromAddress?: string
  toAddress?: string
}

export interface ListingItem {
  tokenId: string
  pricePerItem: { amount: string; currency: string; usd?: number }
  expirationTime?: string
  traits?: Array<{ trait_type: string; value: string | number }>
}

// Module-level holder. Set once per Worker fetch handler invocation via
// `setOpenseaApiKey(env.OPENSEA_API_KEY)` from `src/index.ts`. Workers
// don't expose `process.env`, and threading the key through every call
// site would balloon the diff. Concurrency-safe because env is bound to
// the isolate, not the request — every concurrent request in a single
// isolate sees the same value.
let openseaApiKey: string | undefined

export function setOpenseaApiKey(key: string): void {
  openseaApiKey = key
}

function authHeaders(): HeadersInit {
  if (!openseaApiKey) {
    throw new Error(
      "OpenSea API key not initialized. Call setOpenseaApiKey() from your fetch handler.",
    )
  }
  return {
    "X-API-KEY": openseaApiKey,
    Accept: "application/json",
  }
}

async function fetchJson<T>(endpoint: string): Promise<T> {
  const url = `${BASE_URL}${endpoint}`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    let body = ""
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    throw new OpenSeaError(
      `OpenSea ${res.status} on ${endpoint}: ${body.slice(0, 200)}`,
      res.status,
      endpoint,
    )
  }
  return (await res.json()) as T
}

export async function getCollectionByContract(
  chain: string,
  contract: string,
): Promise<CollectionContractRef> {
  const data = await fetchJson<{ collection: string; address: string }>(
    `/chain/${chain}/contract/${contract}`,
  )
  return { slug: data.collection, contract: data.address }
}

export async function getCollection(slug: string): Promise<CollectionStats> {
  const collection = await fetchJson<{
    collection: string
    name: string
    description?: string
    total_supply?: number
    num_owners?: number
  }>(`/collections/${slug}`)

  const stats = await fetchJson<{
    total: {
      volume?: number
      floor_price?: number
      floor_price_symbol?: string
    }
    intervals: Array<{ interval: string; volume: number }>
  }>(`/collections/${slug}/stats`).catch(() => null)

  const oneDay = stats?.intervals?.find(i => i.interval === "one_day")?.volume

  return {
    slug: collection.collection,
    name: collection.name,
    description: collection.description,
    totalSupply: collection.total_supply,
    numOwners: collection.num_owners,
    totalVolume: stats?.total?.volume,
    oneDayVolume: oneDay,
    floorPrice: stats?.total?.floor_price
      ? {
          amount: String(stats.total.floor_price),
          currency: stats.total.floor_price_symbol ?? "ETH",
        }
      : undefined,
  }
}

export async function getNft(
  chain: string,
  contract: string,
  tokenId: string,
): Promise<NftDetail> {
  const data = await fetchJson<{
    nft: {
      identifier: string
      name?: string
      description?: string
      image_url?: string
      traits?: Array<{
        trait_type: string
        value: string | number
        display_type?: string
      }>
      rarity?: { rank?: number; score?: number }
    }
  }>(`/chain/${chain}/contract/${contract}/nfts/${tokenId}`)
  return {
    identifier: data.nft.identifier,
    name: data.nft.name,
    description: data.nft.description,
    imageUrl: data.nft.image_url,
    traits: data.nft.traits ?? [],
    rarity: data.nft.rarity,
  }
}

export async function getRecentSales(
  chain: string,
  contract: string,
  tokenId: string,
  limit = 20,
): Promise<SaleEvent[]> {
  const data = await fetchJson<{
    asset_events: Array<{
      event_type: string
      event_timestamp: number
      nft?: { identifier: string }
      payment?: { symbol: string; decimals: number; quantity: string }
      quantity?: string
      seller?: string
      buyer?: string
    }>
  }>(
    `/events/chain/${chain}/contract/${contract}/nfts/${tokenId}?event_type=sale&limit=${limit}`,
  )
  return (data.asset_events ?? [])
    .filter(e => e.event_type === "sale" && e.payment)
    .map(e => ({
      tokenId: e.nft?.identifier ?? tokenId,
      eventTimestamp: new Date((e.event_timestamp ?? 0) * 1000).toISOString(),
      paymentToken: {
        symbol: e.payment?.symbol ?? "ETH",
        decimals: e.payment?.decimals ?? 18,
      },
      totalPrice: e.payment?.quantity ?? "0",
      fromAddress: e.seller,
      toAddress: e.buyer,
    }))
}

interface ListingsPage {
  listings: Array<{
    protocol_data?: {
      parameters?: {
        offer?: Array<{ identifierOrCriteria?: string }>
        consideration?: Array<{ startAmount?: string; token?: string }>
      }
    }
    price?: {
      current?: { value?: string; currency?: string; decimals?: number }
    }
  }>
  next?: string
}

const LISTINGS_PAGE_MAX = 200

export async function getCollectionListings(
  slug: string,
  limit = 50,
): Promise<ListingItem[]> {
  // Dedupe by tokenId, keeping the cheapest listing per token. The OpenSea
  // listings endpoint returns one row per Seaport order, so a token relisted
  // N times shows up N times — without dedup, the comp pool fills up with
  // duplicates of whichever token is sitting at floor.
  const byToken = new Map<string, ListingItem>()
  let fetched = 0
  let cursor: string | undefined

  while (fetched < limit) {
    const pageSize = Math.min(LISTINGS_PAGE_MAX, limit - fetched)
    const cursorParam = cursor ? `&next=${encodeURIComponent(cursor)}` : ""
    const page = await fetchJson<ListingsPage>(
      `/listings/collection/${slug}/all?limit=${pageSize}${cursorParam}`,
    )

    const rows = page.listings ?? []
    if (rows.length === 0) break

    for (const l of rows) {
      const tokenId =
        l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria
      const value = l.price?.current?.value
      const currency = l.price?.current?.currency ?? "ETH"
      if (!tokenId || !value) continue
      const existing = byToken.get(tokenId)
      if (existing && BigInt(existing.pricePerItem.amount) <= BigInt(value)) {
        continue
      }
      byToken.set(tokenId, {
        tokenId,
        pricePerItem: { amount: value, currency },
      })
    }

    fetched += rows.length
    if (!page.next || rows.length < pageSize) break
    cursor = page.next
  }

  return [...byToken.values()]
}

/**
 * Pick which listings to enrich. For "broad" mode we take a stratified
 * sample — half the cheapest, half the most expensive — so the LLM sees
 * both floor-anchor comps AND rank-tier comps (rare items are typically
 * listed at high prices, so they live in the most-expensive tail). For
 * "cheap" mode we just take the cheapest, which is enough when the target
 * is unremarkable and no tier-adjacent reasoning applies.
 *
 * OpenSea v2 has no rarity-sorted endpoint (see dogfood feedback #19/#20),
 * so price-tail-as-rarity-proxy is the cheapest way to get rank-tier comps
 * into the pool without N pages of /collection/{slug}/nfts.
 */
export function selectListingsForEnrichment(
  listings: ListingItem[],
  mode: "cheap" | "stratified",
  maxTokens: number,
): ListingItem[] {
  if (listings.length <= maxTokens) return listings
  const sorted = [...listings].sort((a, b) => {
    const ax = BigInt(a.pricePerItem.amount)
    const bx = BigInt(b.pricePerItem.amount)
    return ax < bx ? -1 : ax > bx ? 1 : 0
  })
  if (mode === "cheap") return sorted.slice(0, maxTokens)
  const half = Math.floor(maxTokens / 2)
  const cheapest = sorted.slice(0, half)
  const mostExpensive = sorted.slice(-(maxTokens - half))
  return [...cheapest, ...mostExpensive]
}

/**
 * Enrich listings with traits via parallel `getNft` calls. The v2 listings
 * endpoint doesn't include traits, and there's no v2 endpoint that returns
 * "active listings + traits" in one round trip (see dogfood feedback #19),
 * so we N+1 fan-out. Capped at `maxTokens` to bound the cost.
 *
 * Failed enrichments (a single getNft 404 or rate-limit) drop the listing
 * from the returned array rather than fail the whole appraisal — a comp
 * pool with one missing entry is still useful.
 */
export async function enrichListingsWithTraits(
  chain: string,
  contract: string,
  listings: ListingItem[],
  options: { maxTokens?: number; mode?: "cheap" | "stratified" } = {},
): Promise<ListingItem[]> {
  const maxTokens = options.maxTokens ?? 30
  const mode = options.mode ?? "cheap"
  const candidates = selectListingsForEnrichment(listings, mode, maxTokens)
  const enriched = await Promise.all(
    candidates.map(async (listing): Promise<ListingItem | null> => {
      try {
        const nft = await getNft(chain, contract, listing.tokenId)
        return {
          ...listing,
          traits: nft.traits.map(t => ({
            trait_type: t.trait_type,
            value: t.value,
          })),
        }
      } catch {
        return null
      }
    }),
  )
  return enriched.filter((x): x is ListingItem => x !== null)
}
