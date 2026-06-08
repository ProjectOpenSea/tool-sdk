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
    throw new OpenSeaError(
      `OpenSea API returned ${res.status} on ${endpoint}`,
      res.status,
      endpoint,
    )
  }
  return (await res.json()) as T
}

// ---------- Token holders ----------

export interface TokenHolder {
  address: string
  quantity: number
  usdValue: number
}

export async function getTokenHolders(
  chain: string,
  tokenAddress: string,
  maxPages = 5,
): Promise<TokenHolder[]> {
  const holders: TokenHolder[] = []
  let cursor: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    // The token-holders endpoint returns `quantity` and `usd_value` as
    // strings (token amounts can exceed JS-safe integers), so coerce to
    // number. `Number(...) || 0` guards against missing/non-numeric values.
    const data = await fetchJson<{
      holders: Array<{
        owner_address: string
        quantity: number | string
        usd_value?: number | string
      }>
      next?: string
    }>(`/chain/${chain}/token/${tokenAddress}/holders?limit=100${cursorParam}`)
    for (const h of data.holders) {
      holders.push({
        address: h.owner_address.toLowerCase(),
        quantity: Number(h.quantity) || 0,
        usdValue: Number(h.usd_value ?? 0) || 0,
      })
    }
    if (!data.next) break
    cursor = data.next
  }
  return holders
}

// ---------- Collection holders ----------

export interface CollectionHolder {
  address: string
  quantity: number
  ownershipPct: number
}

export async function getCollectionHolders(
  slug: string,
  maxPages = 5,
): Promise<CollectionHolder[]> {
  const holders: CollectionHolder[] = []
  let cursor: string | undefined
  for (let i = 0; i < maxPages; i++) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    const data = await fetchJson<{
      holders: Array<{
        address: string
        quantity: number
        percentage: number
      }>
      next?: string
    }>(`/collections/${slug}/holders?limit=100${cursorParam}`)
    for (const h of data.holders) {
      holders.push({
        address: h.address.toLowerCase(),
        quantity: h.quantity,
        ownershipPct: h.percentage,
      })
    }
    if (!data.next) break
    cursor = data.next
  }
  return holders
}

// ---------- Metadata ----------

export async function getCollectionMeta(
  slug: string,
): Promise<{ name: string; floorPriceEth: number | null }> {
  const [collection, stats] = await Promise.all([
    fetchJson<{ name: string }>(`/collections/${slug}`),
    fetchJson<{ total: { floor_price?: number } }>(
      `/collections/${slug}/stats`,
    ).catch(() => ({ total: {} as { floor_price?: number } })),
  ])
  return {
    name: collection.name,
    floorPriceEth: stats.total.floor_price ?? null,
  }
}

export async function getTokenMeta(
  chain: string,
  address: string,
): Promise<{ name: string; symbol: string }> {
  const data = await fetchJson<{ name?: string; symbol?: string }>(
    `/chain/${chain}/token/${address}`,
  )
  return { name: data.name ?? "Unknown", symbol: data.symbol ?? "???" }
}

export async function getAccountUsername(
  address: string,
): Promise<string | null> {
  try {
    const data = await fetchJson<{ username?: string }>(`/accounts/${address}`)
    return data.username ?? null
  } catch {
    return null
  }
}
