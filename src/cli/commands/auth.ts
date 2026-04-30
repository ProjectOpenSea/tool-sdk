import { Command } from "commander"
import pc from "picocolors"
import { privateKeyToAccount } from "viem/accounts"
import { authenticatedFetch } from "../../lib/client/siwe-auth.js"
import { readInput } from "./read-input.js"

interface AuthOptions {
  body?: string
  key?: string
}

export const authCommand = new Command("auth")
  .description(
    "Make an authenticated call to a predicate-gated tool endpoint via SIWE",
  )
  .argument("<url>", "Tool endpoint URL")
  .option("--body <json>", "JSON body (inline string or @path/to/file.json)")
  .option(
    "--key <hex>",
    "Wallet private key (defaults to TOOL_SDK_PRIVATE_KEY env var). WARNING: CLI args may appear in shell history and process listings; prefer the env var for production use",
  )
  .action(async (url: string, options: AuthOptions) => {
    const privateKey = options.key ?? process.env.TOOL_SDK_PRIVATE_KEY
    if (!privateKey) {
      console.error(
        pc.red("Error: Provide --key or set the TOOL_SDK_PRIVATE_KEY env var"),
      )
      process.exit(1)
    }

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

    try {
      JSON.parse(inputBody)
    } catch {
      console.error(pc.red("Error: Body is not valid JSON"))
      process.exit(1)
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      console.error(pc.red(`Error: Invalid URL: ${url}`))
      process.exit(1)
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`)

    console.log(pc.cyan("Building SIWE message..."))
    console.log(`  Address: ${account.address}`)
    console.log(`  Domain: ${parsedUrl.host}`)
    console.log(`  Expires: ${new Date(Date.now() + 5 * 60_000).toISOString()}`)

    console.log(
      pc.cyan(`\nSigning and sending authenticated request to ${url}...\n`),
    )

    let res: globalThis.Response
    try {
      res = await authenticatedFetch(url, {
        account,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: inputBody,
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      console.error(pc.red(`Error: Failed to reach ${url}`))
      console.error(pc.dim(err instanceof Error ? err.message : String(err)))
      process.exit(1)
    }

    console.log(`Status: ${res.status}`)
    const responseText = await res.text()
    console.log(responseText)

    if (res.status === 401) {
      console.log(
        pc.yellow(
          "\nSIWE authentication failed — check that your wallet key is correct and the message format matches the tool's expectations",
        ),
      )
    } else if (res.status === 403) {
      let hint =
        "Access denied — your wallet does not satisfy the tool's access predicate."
      try {
        const body = JSON.parse(responseText) as {
          predicate?: string
          toolId?: string
        }
        if (body.predicate) {
          hint += ` The predicate at ${body.predicate} denied access.`
        }
        if (body.toolId) {
          hint += ` Check requirements with tool-sdk inspect --tool-id ${body.toolId}`
        }
      } catch {
        hint +=
          " Check the tool's requirements with tool-sdk inspect --tool-id <id>"
      }
      console.log(pc.yellow(`\n${hint}`))
    }
  })
