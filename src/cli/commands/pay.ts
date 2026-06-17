import { Command } from "commander"
import pc from "picocolors"
import { parseX402Challenge } from "../../lib/client/x402-challenge.js"
import {
  signX402Payment,
  validatePaymentRequirements,
  X402_SETTLEMENT_HEADERS,
  x402PaymentHeaderName,
} from "../../lib/client/x402-payment.js"
import {
  createWalletForProvider,
  createWalletFromEnv,
  WALLET_PROVIDERS,
  type WalletAdapter,
  type WalletProvider,
} from "../../lib/wallet/index.js"
import { readInput } from "./read-input.js"

interface PayOptions {
  body?: string
  method?: string
  maxAmount?: string
  walletProvider?: string
}

/** HTTP verbs that carry no request body — inputs go in the query string. */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE"])

const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org"

/** Default ceiling on what the server may charge: 10 USDC (6 decimals). */
const DEFAULT_MAX_AMOUNT = "10000000"

export const payCommand = new Command("pay")
  .description(
    "Make a paid call to a tool endpoint via x402. Probes for a 402 challenge, signs X-Payment, and retries.",
  )
  .argument("<url>", "Tool endpoint URL")
  .option("--body <json>", "JSON body (inline string or @path/to/file.json)")
  .option(
    "--method <verb>",
    "HTTP method (GET, POST, PUT, PATCH, DELETE). Defaults to POST; falls back to GET automatically if a POST probe 404/405s.",
  )
  .option(
    "--wallet-provider <provider>",
    `Wallet provider: ${WALLET_PROVIDERS.join(", ")}`,
  )
  .option(
    "--max-amount <baseUnits>",
    `Reject challenges that charge more than this (token base units). Pass "unlimited" to disable. Defaults to ${DEFAULT_MAX_AMOUNT} (10 USDC).`,
  )
  .action(async (url: string, options: PayOptions) => {
    // The x402 X-Payment signature is a gasless EIP-3009 authorization — it is
    // never broadcast, so no RPC is actually needed to sign. The private-key
    // adapter still requires RPC_URL, so default it to a public Base endpoint
    // rather than failing with a confusing error.
    if (
      !options.walletProvider &&
      process.env.PRIVATE_KEY &&
      !process.env.RPC_URL
    ) {
      process.env.RPC_URL = DEFAULT_BASE_RPC_URL
      console.log(
        pc.dim(`Note: RPC_URL not set, defaulting to ${DEFAULT_BASE_RPC_URL}`),
      )
    }

    let adapter: WalletAdapter
    try {
      adapter = options.walletProvider
        ? createWalletForProvider(options.walletProvider as WalletProvider)
        : createWalletFromEnv()
    } catch (err) {
      console.error(
        pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      )
      console.error(
        pc.dim(
          `Configure a wallet via PRIVATE_KEY (+ optional RPC_URL) or --wallet-provider <${WALLET_PROVIDERS.join("|")}>.`,
        ),
      )
      process.exit(1)
    }

    const address = await adapter.getAddress()
    console.log(pc.cyan(`Wallet: ${address} (${adapter.name})`))

    let inputBody = "{}"
    if (options.body) {
      inputBody = readInput(options.body)
    } else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer)
      }
      const stdinData = Buffer.concat(chunks).toString("utf-8").trim()
      if (stdinData) {
        inputBody = stdinData
      }
    }

    let params: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(inputBody)
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("not an object")
      }
      params = parsed as Record<string, unknown>
    } catch {
      console.error(pc.red("Error: Body must be a JSON object"))
      process.exit(1)
    }

    const explicitMethod = options.method != null
    const method = (options.method ?? "POST").toUpperCase()

    const maxAmount =
      options.maxAmount === "unlimited"
        ? undefined
        : (options.maxAmount ?? DEFAULT_MAX_AMOUNT)

    await runPaymentOnly(
      url,
      params,
      method,
      explicitMethod,
      adapter,
      maxAmount,
    )
  })

/** Append a flat params object onto a URL's query string. */
function withQuery(url: string, params: Record<string, unknown>): string {
  const u = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    u.searchParams.set(
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    )
  }
  return u.toString()
}

/**
 * Build the request URL + init for a given method. Bodyless verbs (GET/HEAD/
 * DELETE) carry inputs in the query string; everything else sends a JSON body.
 */
function buildRequest(
  url: string,
  params: Record<string, unknown>,
  method: string,
): { requestUrl: string; init: RequestInit } {
  if (BODYLESS_METHODS.has(method)) {
    return {
      requestUrl: withQuery(url, params),
      init: { method, signal: AbortSignal.timeout(30_000) },
    }
  }
  return {
    requestUrl: url,
    init: {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    },
  }
}

async function runPaymentOnly(
  url: string,
  params: Record<string, unknown>,
  initialMethod: string,
  explicitMethod: boolean,
  adapter: WalletAdapter,
  maxAmount: string | undefined,
): Promise<void> {
  console.log(pc.cyan("Probing endpoint for payment requirements..."))

  let method = initialMethod
  let { requestUrl, init } = buildRequest(url, params, method)

  let probeRes: globalThis.Response
  try {
    probeRes = await fetch(requestUrl, init)
  } catch (err) {
    console.error(pc.red(`Error: Failed to reach ${requestUrl}`))
    console.error(pc.dim(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  // Many x402 tools (especially bazaar-discovered ones) only serve GET. If the
  // caller didn't pin a method and a POST probe 404/405s, retry as GET.
  if (
    !explicitMethod &&
    method !== "GET" &&
    (probeRes.status === 404 || probeRes.status === 405)
  ) {
    console.log(
      pc.dim(`${method} returned ${probeRes.status}; retrying probe as GET...`),
    )
    method = "GET"
    ;({ requestUrl, init } = buildRequest(url, params, method))
    try {
      probeRes = await fetch(requestUrl, init)
    } catch (err) {
      console.error(pc.red(`Error: Failed to reach ${requestUrl}`))
      console.error(pc.dim(err instanceof Error ? err.message : String(err)))
      process.exit(1)
    }
  }

  if (probeRes.status !== 402) {
    console.log(
      pc.yellow(
        `Endpoint returned ${probeRes.status} (expected 402). Printing response:`,
      ),
    )
    console.log(await probeRes.text())
    return
  }

  const parsed = await parseX402Challenge(probeRes)
  if (!parsed.ok) {
    console.error(pc.red(`Error: ${parsed.reason}`))
    process.exit(1)
  }
  const { requirements, x402Version, raw, resource } = parsed

  // Apply the same guardrails as `paidFetch`: reject burn/zero recipients,
  // non-USDC assets, and amounts above the cap before signing anything.
  try {
    validatePaymentRequirements(requirements, { maxAmount })
  } catch (err) {
    console.error(
      pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
    )
    console.error(
      pc.dim(
        "Pass --max-amount <baseUnits> (or `unlimited`) to adjust the cap.",
      ),
    )
    process.exit(1)
  }

  console.log(pc.cyan("Payment requirements:"))
  console.log(`  Method: ${method}`)
  console.log(`  x402 version: ${x402Version}`)
  console.log(`  Scheme: ${requirements.scheme}`)
  console.log(`  Network: ${requirements.network}`)
  console.log(`  Amount: ${requirements.maxAmountRequired}`)
  console.log(`  Pay To: ${requirements.payTo}`)
  console.log(`  Asset: ${requirements.asset}`)

  console.log(pc.cyan("\nSigning EIP-3009 transferWithAuthorization..."))

  const xPayment = await signX402Payment({
    signer: adapter,
    paymentRequirements: requirements,
    x402Version,
    accepted: raw,
    resource,
  })

  const headerName = x402PaymentHeaderName(x402Version)
  console.log(pc.cyan(`Replaying request with ${headerName} header...`))

  let paidRes: globalThis.Response
  try {
    paidRes = await fetch(requestUrl, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        [headerName]: xPayment,
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.error(pc.red("Error: Paid request failed"))
    console.error(pc.dim(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  const settlement = X402_SETTLEMENT_HEADERS.map(h =>
    paidRes.headers.get(h),
  ).find(v => v != null)
  if (settlement) {
    try {
      const decoded = JSON.parse(
        Buffer.from(settlement, "base64").toString("utf-8"),
      )
      if (decoded.transaction) {
        console.log(pc.green(`Settled on-chain: ${decoded.transaction}`))
      }
    } catch {
      // Non-base64 settlement header — ignore, the body is what matters.
    }
  }

  console.log(pc.cyan(`\nResponse (${paidRes.status}):`))
  console.log(await paidRes.text())
}
