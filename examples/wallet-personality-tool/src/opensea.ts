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

export interface AccountProfile {
  address: string
  username: string | null
  ens: string | null
  bannerImageUrl: string | null
  profileImageUrl: string | null
}

export interface AccountNft {
  identifier: string
  collection: string
  contract: string
  name: string | null
  imageUrl: string | null
  chain: string
}

export interface CollectionStats {
  slug: string
  name: string
  description: string | null
  /**
   * Year the collection was first deployed (UTC). Cheap signal for OG vs
   * recent — "tiny dinos 2022" reads very different from "burds 2025".
   */
  createdAtYear: number | null
  /** Primary chain identifier (e.g. "ethereum", "base"). First contract wins. */
  chain: string | null
  totalSupply: number | null
  numOwners: number | null
  floorEth: number | null
  contractAddresses: string[]
}

/**
 * OpenSea v2 supported event types. Per the OpenAPI spec only the
 * following are accepted as `event_type` query values:
 *   sale | transfer | mint | listing | offer | trait_offer | collection_offer
 * "Listings cancelled" is not exposed here (it lives on the Stream API),
 * so the digest reports it as 0.
 */
export type AccountEventType =
  | "sale"
  | "transfer"
  | "mint"
  | "listing"
  | "offer"
  | "trait_offer"
  | "collection_offer"

export interface AccountEvent {
  eventType: string
  /** Unix seconds. */
  eventTimestamp: number
  /** Buyer in a sale, recipient in a transfer, account in a listing. */
  toAddress?: string
  /** Seller in a sale, sender in a transfer. */
  fromAddress?: string
  collectionSlug?: string
  contract?: string
  tokenId?: string
  chain?: string
  /** ETH-equivalent price for sales/listings. Best-effort. */
  ethValue?: number
  paymentSymbol?: string
  /** Raw event for callers that need fields we haven't typed. */
  raw: unknown
}

function authHeaders(): Record<string, string> {
  const key = process.env.OPENSEA_API_KEY
  if (!key) {
    throw new Error(
      "OPENSEA_API_KEY env var is not set. Set it in .env.local for `vercel dev` or in the Vercel project for deploy.",
    )
  }
  return {
    "X-API-KEY": key,
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

export async function getAccount(address: string): Promise<AccountProfile> {
  const data = await fetchJson<{
    address: string
    username?: string | null
    profile_image_url?: string | null
    banner_image_url?: string | null
    website?: string | null
    social_media_accounts?: unknown
    bio?: string | null
    joined_date?: string | null
  }>(`/accounts/${address}`)
  // OpenSea v2 doesn't return ENS reliably from /accounts. Inferring it
  // from username only when the username matches *.eth shape — best
  // effort. Real reverse resolution (mainnet UniversalResolver) is a
  // separate concern and requires the wallet owner to have set their
  // primary ENS name on chain.
  const looksLikeEns =
    typeof data.username === "string" && /^[\w-]+\.eth$/i.test(data.username)
  return {
    address: data.address,
    username: data.username ?? null,
    ens: looksLikeEns ? (data.username as string) : null,
    bannerImageUrl: data.banner_image_url ?? null,
    profileImageUrl: data.profile_image_url ?? null,
  }
}

interface AccountNftsPage {
  nfts: Array<{
    identifier: string
    collection: string
    contract: string
    name?: string | null
    image_url?: string | null
    is_disabled?: boolean
    is_nsfw?: boolean
  }>
  next?: string
}

const MAX_NFT_PAGES = 5
const NFT_PAGE_SIZE = 50

/**
 * Paginate `GET /chain/{chain}/account/{address}/nfts` up to `MAX_NFT_PAGES`.
 * The cap is 5 pages × 50 = 250 NFTs per chain. Whales hold more than
 * that; the digest uses top-10-by-count anyway, so the long tail doesn't
 * change the shape of the personality.
 */
export async function getAccountNfts(
  chain: string,
  address: string,
): Promise<AccountNft[]> {
  const out: AccountNft[] = []
  let cursor: string | undefined
  for (let i = 0; i < MAX_NFT_PAGES; i++) {
    const cursorParam = cursor ? `&next=${encodeURIComponent(cursor)}` : ""
    const data = await fetchJson<AccountNftsPage>(
      `/chain/${chain}/account/${address}/nfts?limit=${NFT_PAGE_SIZE}${cursorParam}`,
    )
    const rows = data.nfts ?? []
    for (const r of rows) {
      if (r.is_disabled || r.is_nsfw) continue
      out.push({
        identifier: r.identifier,
        collection: r.collection,
        contract: r.contract,
        name: r.name ?? null,
        imageUrl: r.image_url ?? null,
        chain,
      })
    }
    if (!data.next || rows.length < NFT_PAGE_SIZE) break
    cursor = data.next
  }
  return out
}

/**
 * Truncate at a word boundary to keep token usage in the digest predictable.
 * 280 chars is enough for one or two sentences of genre signal — past that
 * we're paying for fluff the LLM doesn't need.
 */
function truncateDescription(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length <= 280) return trimmed
  const cut = trimmed.slice(0, 280)
  const lastSpace = cut.lastIndexOf(" ")
  return `${cut.slice(0, lastSpace > 200 ? lastSpace : 280).trimEnd()}…`
}

export async function getCollection(
  slug: string,
): Promise<CollectionStats | null> {
  try {
    const collection = await fetchJson<{
      collection: string
      name: string
      description?: string | null
      created_date?: string | null
      total_supply?: number
      num_owners?: number
      contracts?: Array<{ address: string; chain: string }>
    }>(`/collections/${slug}`)
    const stats = await fetchJson<{
      total: { floor_price?: number; floor_price_symbol?: string }
    }>(`/collections/${slug}/stats`).catch(() => null)
    const firstContract = collection.contracts?.[0]
    const createdAtYear = (() => {
      if (!collection.created_date) return null
      const ts = Date.parse(collection.created_date)
      if (Number.isNaN(ts)) return null
      return new Date(ts).getUTCFullYear()
    })()
    return {
      slug: collection.collection,
      name: collection.name,
      description: truncateDescription(collection.description),
      createdAtYear,
      chain: firstContract?.chain ?? null,
      totalSupply: collection.total_supply ?? null,
      numOwners: collection.num_owners ?? null,
      floorEth:
        typeof stats?.total?.floor_price === "number"
          ? stats.total.floor_price
          : null,
      contractAddresses: (collection.contracts ?? []).map(c => c.address),
    }
  } catch (err) {
    if (
      err instanceof OpenSeaError &&
      (err.status === 404 || err.status === 400)
    ) {
      return null
    }
    throw err
  }
}

interface AccountEventsPage {
  asset_events: Array<{
    event_type: string
    event_timestamp?: number
    transaction?: string
    from_address?: string
    to_address?: string
    seller?: string
    buyer?: string
    chain?: string
    nft?: {
      identifier?: string
      collection?: string
      contract?: string
    }
    payment?: {
      symbol?: string
      decimals?: number
      quantity?: string
    }
    quantity?: number
    /** Order events (listings, cancellations) carry a different shape. */
    maker?: string
    order_type?: string
  }>
  next?: string
}

function ethValueFromPayment(payment?: {
  symbol?: string
  decimals?: number
  quantity?: string
}): { ethValue?: number; symbol?: string } {
  if (!payment?.quantity) return {}
  const decimals = payment.decimals ?? 18
  const symbol = payment.symbol ?? "ETH"
  // Only treat ETH/WETH as eth-equivalent. Stable-priced sales (USDC etc.)
  // get an undefined ethValue; the LLM doesn't need exact non-ETH pricing
  // to read trading style.
  if (symbol !== "ETH" && symbol !== "WETH") return { symbol }
  try {
    const big = BigInt(payment.quantity)
    const denom = 10 ** decimals
    return { ethValue: Number(big) / denom, symbol }
  } catch {
    return { symbol }
  }
}

const MAX_EVENT_PAGES = 10
const EVENT_PAGE_SIZE = 50

/**
 * `GET /events/account/{address}` paginated. Filters by event_type list.
 * Caps at `MAX_EVENT_PAGES × EVENT_PAGE_SIZE = 500` events. For 90-day
 * activity that's plenty for non-whale wallets; whales lose tail accuracy
 * but the per-bucket digest signals are unchanged.
 */
export async function getAccountEvents(
  address: string,
  opts: {
    eventTypes?: AccountEventType[]
    afterUnix?: number
    beforeUnix?: number
    chain?: string
    maxPages?: number
  } = {},
): Promise<AccountEvent[]> {
  const out: AccountEvent[] = []
  const eventTypes = opts.eventTypes ?? ["sale", "transfer"]
  const eventParam = eventTypes
    .map(t => `event_type=${encodeURIComponent(t)}`)
    .join("&")
  const afterParam = opts.afterUnix ? `&after=${opts.afterUnix}` : ""
  const beforeParam = opts.beforeUnix ? `&before=${opts.beforeUnix}` : ""
  const chainParam = opts.chain
    ? `&chain=${encodeURIComponent(opts.chain)}`
    : ""
  const maxPages = opts.maxPages ?? MAX_EVENT_PAGES
  let cursor: string | undefined

  for (let i = 0; i < maxPages; i++) {
    const cursorParam = cursor ? `&next=${encodeURIComponent(cursor)}` : ""
    const data = await fetchJson<AccountEventsPage>(
      `/events/accounts/${address}?${eventParam}&limit=${EVENT_PAGE_SIZE}${afterParam}${beforeParam}${chainParam}${cursorParam}`,
    )
    const rows = data.asset_events ?? []
    for (const r of rows) {
      const { ethValue, symbol } = ethValueFromPayment(r.payment)
      out.push({
        eventType: r.event_type,
        eventTimestamp: r.event_timestamp ?? 0,
        toAddress: r.to_address ?? r.buyer,
        fromAddress: r.from_address ?? r.seller,
        collectionSlug: r.nft?.collection,
        contract: r.nft?.contract,
        tokenId: r.nft?.identifier,
        chain: r.chain,
        ethValue,
        paymentSymbol: symbol,
        raw: r,
      })
    }
    if (!data.next || rows.length < EVENT_PAGE_SIZE) break
    cursor = data.next
  }
  return out
}
