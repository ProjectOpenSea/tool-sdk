import { type Chain, createPublicClient, http, namehash } from "viem"
import { base, mainnet } from "viem/chains"
import { getEnsText, normalize } from "viem/ens"
import { ToolRegistryClient } from "../onchain/registry.js"
import { parseCAIP19ToolRef } from "./caip19.js"
import type {
  ApplicationSubname,
  CAIP19ToolRef,
  DiscoveredTool,
  ENSDiscoveryError,
  ENSDiscoveryOptions,
  ENSDiscoveryResult,
  OriginVerification,
  SubnameResolver,
  ToolConfig,
} from "./types.js"

/**
 * The maximum number of registration slots to probe per subname.
 * Prevents runaway reads against malformed ENS records.
 */
const MAX_REGISTRATION_SLOTS = 64

const FETCH_TIMEOUT_MS = 5_000
const SUBGRAPH_PAGE_SIZE = 100
const MAX_SUBGRAPH_PAGES = 10

/** Known chains for resolving CAIP-19 chain IDs to viem Chain objects. */
const CHAIN_BY_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
}

/**
 * Creates a simple static subname resolver from an array of known subnames.
 * Useful for testing or when subnames are already known.
 */
export function staticSubnameResolver(subnames: string[]): SubnameResolver {
  return {
    async resolveSubnames() {
      return subnames
    },
  }
}

/**
 * Default subname resolver using the ENS subgraph on The Graph Network.
 * Paginates through all first-level subnames of the given ENS name.
 */
export function subgraphSubnameResolver(
  subgraphUrl = "https://gateway.thegraph.com/api/subgraphs/id/5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH",
): SubnameResolver {
  return {
    async resolveSubnames(ensName: string): Promise<string[]> {
      const node = namehash(normalize(ensName))
      const allSubnames: string[] = []
      let lastId = ""

      for (let page = 0; page < MAX_SUBGRAPH_PAGES; page++) {
        const whereClause = lastId
          ? `{ parentDomain: "${node}", id_gt: "${lastId}" }`
          : `{ parentDomain: "${node}" }`
        const query = `{
          domains(where: ${whereClause}, first: ${SUBGRAPH_PAGE_SIZE}, orderBy: id) {
            id
            name
          }
        }`

        const response = await fetch(subgraphUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (!response.ok) {
          throw new Error(
            `ENS subgraph query failed: ${response.status} ${response.statusText}`,
          )
        }

        const json = (await response.json()) as {
          data?: { domains?: { id: string; name: string }[] }
        }
        const domains = json.data?.domains ?? []
        for (const d of domains) {
          allSubnames.push(d.name)
        }

        if (domains.length < SUBGRAPH_PAGE_SIZE) break
        lastId = domains[domains.length - 1].id
      }

      return allSubnames
    },
  }
}

/**
 * Discovers ERC-8257 tools registered under an ENS name by traversing
 * subnames, reading Application schemas, fetching tool configs from the
 * onchain registry, and verifying origin attestations on both ends.
 *
 * This implements the discovery flow described in the ENS × ERC-8257 proposal:
 *
 * 1. Given an ENS name, walk subnames.
 * 2. Discover Application schemas (subnames with `registrations[*]` text records).
 * 3. Enumerate CAIP-19 registrations.
 * 4. Fetch each tool from the 8257 registry.
 * 5. Verify origin attestations on both ends (tool endpoint ↔ ENS attestation).
 *
 * @example
 * ```ts
 * import { discoverToolsFromENS } from "@opensea/tool-sdk"
 *
 * const result = await discoverToolsFromENS({
 *   ensName: "uniswap.eth",
 * })
 *
 * for (const tool of result.tools) {
 *   console.log(tool.caip19.raw, tool.originVerification.verified)
 * }
 * ```
 */
export async function discoverToolsFromENS(
  options: ENSDiscoveryOptions,
): Promise<ENSDiscoveryResult> {
  const ensChain = options.ensChain ?? mainnet
  const registrationsKey = options.registrationsKey ?? "registrations"
  const attestationsKey = options.attestationsKey ?? "attestations"
  const errors: ENSDiscoveryError[] = []

  const ensClient = createPublicClient({
    chain: ensChain,
    transport: http(options.ensRpcUrl),
  })

  // Step 1: Resolve subnames
  const resolver =
    options.subnameResolver ??
    subgraphSubnameResolver(options.subgraphUrl)

  let subnames: string[]
  try {
    subnames = await resolver.resolveSubnames(options.ensName)
  } catch (err) {
    errors.push({
      phase: "subname-resolution",
      context: options.ensName,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ensName: options.ensName, applications: [], tools: [], errors }
  }

  // Step 2: For each subname, read registrations text records
  const applications: ApplicationSubname[] = []

  for (const subname of subnames) {
    const registrations: CAIP19ToolRef[] = []
    try {
      for (let i = 0; i < MAX_REGISTRATION_SLOTS; i++) {
        const key = `${registrationsKey}[${i}]`
        const value = await getEnsText(ensClient, {
          name: normalize(subname),
          key,
        })
        if (!value) break
        try {
          registrations.push(parseCAIP19ToolRef(value))
        } catch (parseErr) {
          errors.push({
            phase: "schema-read",
            context: `${subname} / ${key}`,
            message:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
          })
        }
      }
    } catch (err) {
      errors.push({
        phase: "schema-read",
        context: subname,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (registrations.length > 0) {
      applications.push({ name: subname, registrations })
    }
  }

  // Step 3 & 4: Fetch tool configs and verify attestations
  const tools: DiscoveredTool[] = []

  for (const app of applications) {
    for (const ref of app.registrations) {
      // Fetch tool config from registry using the chain encoded in CAIP-19
      let config: ToolConfig
      try {
        const refChain = resolveChain(ref.chainId, options.registryChain)
        const registry = new ToolRegistryClient({
          chain: refChain,
          rpcUrl: options.registryRpcUrl,
          registryAddress: ref.registryAddress,
        })
        config = await registry.getToolConfig(ref.toolId)
      } catch (err) {
        errors.push({
          phase: "registry-fetch",
          context: ref.raw,
          message: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      // Step 5: Verify origin attestations
      let originVerification: OriginVerification
      try {
        originVerification = await verifyOriginAttestation({
          ensClient,
          subname: app.name,
          caip19Raw: ref.raw,
          toolConfig: config,
          attestationsKey,
        })
      } catch (err) {
        errors.push({
          phase: "attestation-verify",
          context: ref.raw,
          message: err instanceof Error ? err.message : String(err),
        })
        originVerification = {
          toolOrigin: extractOrigin(config.metadataURI) ?? "",
          ensAttestationUrl: null,
          ensAttestationOrigin: null,
          verified: false,
        }
      }

      tools.push({
        sourceName: app.name,
        caip19: ref,
        config,
        originVerification,
      })
    }
  }

  return { ensName: options.ensName, applications, tools, errors }
}

/**
 * Verifies the two-way origin link:
 * - Tool side: extract the origin from the tool's metadataURI or endpoint
 * - ENS side: read `attestations[{CAIP-19}]` text record, extract origin from that URL
 * - If both origins match, the loop is closed.
 */
async function verifyOriginAttestation(params: {
  ensClient: ReturnType<typeof createPublicClient>
  subname: string
  caip19Raw: string
  toolConfig: ToolConfig
  attestationsKey: string
}): Promise<OriginVerification> {
  const { ensClient, subname, caip19Raw, toolConfig, attestationsKey } = params

  // Derive the tool's origin from the metadataURI.
  // If metadataURI is an IPFS/content-hash URI, we try to fetch the manifest
  // to get the endpoint. For https URIs, extract origin directly.
  let toolOrigin = extractOrigin(toolConfig.metadataURI) ?? ""

  // Try to fetch the manifest to get the endpoint origin (more authoritative).
  if (toolConfig.metadataURI.startsWith("https://")) {
    try {
      const resp = await fetch(toolConfig.metadataURI, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (resp.ok) {
        const manifest = (await resp.json()) as { endpoint?: string }
        if (manifest.endpoint) {
          toolOrigin = extractOrigin(manifest.endpoint) ?? toolOrigin
        }
      }
    } catch {
      // Use metadataURI origin as fallback
    }
  }

  // Read ENS attestation record
  const attestationKey = `${attestationsKey}[${caip19Raw}]`
  let ensAttestationUrl: string | null = null
  try {
    ensAttestationUrl = await getEnsText(ensClient, {
      name: normalize(subname),
      key: attestationKey,
    })
  } catch {
    // Record may not exist
  }

  const ensAttestationOrigin = ensAttestationUrl
    ? extractOrigin(ensAttestationUrl)
    : null

  const verified =
    !!toolOrigin &&
    !!ensAttestationOrigin &&
    toolOrigin === ensAttestationOrigin

  return {
    toolOrigin,
    ensAttestationUrl,
    ensAttestationOrigin,
    verified,
  }
}

/**
 * Resolves a CAIP-19 chain ID to a viem Chain object.
 * Throws if the chain is not in the lookup map and no fallback is provided.
 */
function resolveChain(chainId: number, fallback?: Chain): Chain {
  const chain = CHAIN_BY_ID[chainId] ?? fallback
  if (!chain) {
    throw new Error(
      `Unsupported chain ID ${chainId} in CAIP-19 reference. ` +
        `Supported chains: ${Object.keys(CHAIN_BY_ID).join(", ")}. ` +
        `Pass a registryChain option to handle this chain.`,
    )
  }
  return chain
}

function extractOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return null
  }
}
