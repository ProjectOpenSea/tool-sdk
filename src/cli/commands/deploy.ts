import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Command } from "commander"
import pc from "picocolors"
import { deriveSlug } from "../../lib/utils.js"

interface DeployOptions {
  host: string
  nonInteractive?: boolean
  yes?: boolean
}

interface EnvVar {
  name: string
  comment: string
}

export function execCmd(
  cmd: string,
  options?: { input?: string; silent?: boolean; inheritStderr?: boolean },
): string {
  try {
    const stdio: ("pipe" | "inherit")[] = options?.silent
      ? ["pipe", "pipe", "pipe"]
      : options?.input
        ? ["pipe", "pipe", "inherit"]
        : options?.inheritStderr
          ? ["inherit", "pipe", "inherit"]
          : ["inherit", "pipe", "pipe"]

    return execSync(cmd, {
      encoding: "utf-8",
      input: options?.input,
      stdio,
    }).trim()
  } catch (err) {
    const error = err as {
      stderr?: string
      stdout?: string
      message?: string
    }
    const captured = [error.stderr?.trim(), error.stdout?.trim()]
      .filter(Boolean)
      .join("\n")
    const message = captured || error.message || "Unknown error"
    throw new Error(message)
  }
}

export function parseEnvExample(filePath: string): EnvVar[] {
  if (!existsSync(filePath)) {
    return []
  }

  const content = readFileSync(filePath, "utf-8")
  const vars: EnvVar[] = []

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue

    const name = trimmed.slice(0, eqIndex).trim()
    const rest = trimmed.slice(eqIndex + 1).trim()
    if (!rest) continue
    vars.push({ name, comment: rest })
  }

  return vars
}

const SENSITIVE_PATTERN = /(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_PRIVATE)$/i

export function isSensitiveEnvVar(name: string): boolean {
  return SENSITIVE_PATTERN.test(name)
}

export function extractDeploymentUrl(output: string): string | undefined {
  for (const line of output.split("\n")) {
    const match = line.match(/https:\/\/[\w-]+\.vercel\.app/)
    if (match) {
      return match[0]
    }
  }
  return undefined
}

export function fetchExistingEnvVars(): Set<string> {
  try {
    const output = execCmd("npx vercel env ls production --json", {
      silent: true,
    })
    const envList = JSON.parse(output) as { key: string }[]
    return new Set(envList.map(e => e.key))
  } catch {
    console.log(
      pc.dim("  Could not fetch existing env vars, falling back to prompts"),
    )
    return new Set()
  }
}

export async function tryRecoverDeployUrl(
  errorMessage: string,
  cwd: string,
): Promise<string | undefined> {
  const url = extractDeploymentUrl(errorMessage)
  if (!url) return undefined

  const manifestUrl = await deriveManifestUrl(url, cwd)
  if (!manifestUrl) return url

  try {
    const response = await fetch(manifestUrl, { redirect: "manual" })
    if (response.status === 200) return url
  } catch {
    // manifest unreachable
  }

  return undefined
}
async function deriveManifestUrl(
  deploymentUrl: string,
  cwd: string,
): Promise<string | undefined> {
  const manifestPath = resolve(cwd, "src", "manifest.ts")
  if (!existsSync(manifestPath)) return undefined

  try {
    const { loadManifest } = await import("./load-manifest.js")
    const data = await loadManifest(manifestPath)
    const manifest = data as { name?: string }
    if (manifest.name) {
      const slug = deriveSlug(manifest.name)
      return `${deploymentUrl}/.well-known/ai-tool/${slug}.json`
    }
  } catch {
    // Fallback: try reading the package.json name
    try {
      const pkgPath = resolve(cwd, "package.json")
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string
        }
        if (pkg.name) {
          const slug = deriveSlug(pkg.name)
          return `${deploymentUrl}/.well-known/ai-tool/${slug}.json`
        }
      }
    } catch {
      // cannot derive
    }
  }

  return undefined
}

export const deployCommand = new Command("deploy")
  .description("Deploy a tool-sdk project to a hosting platform")
  .requiredOption("--host <host>", "Hosting platform (vercel)")
  .option("--non-interactive", "Read env var values from environment (for CI)")
  .option(
    "-y, --yes",
    "(deprecated, no-op — vercel link is now auto-confirmed)",
  )
  .action(async (options: DeployOptions) => {
    if (options.host !== "vercel") {
      console.error(
        pc.red(
          `Error: Unsupported host "${options.host}". Only "vercel" is currently supported.`,
        ),
      )
      process.exit(1)
    }

    await deployToVercel(options)
  })

async function deployToVercel(options: DeployOptions): Promise<void> {
  const cwd = process.cwd()

  // Step 1: Pre-flight checks
  console.log(pc.cyan("\n1. Pre-flight checks"))

  try {
    execCmd("npx vercel --version", { silent: true })
    console.log(pc.green("  Vercel CLI available"))
  } catch {
    console.error(pc.red("Error: Vercel CLI is not available."))
    console.error(pc.dim("  Run: npm i -g vercel"))
    process.exit(1)
  }

  let vercelScope = ""
  try {
    vercelScope = execCmd("npx vercel whoami", { silent: true })
    console.log(pc.green(`  Logged in as ${vercelScope}`))
  } catch {
    console.error(pc.red("Error: Not logged in to Vercel."))
    console.error(pc.dim("  Run: npx vercel login"))
    process.exit(1)
  }

  // Step 2: Link project
  console.log(pc.cyan("\n2. Link project"))
  const projectJsonPath = resolve(cwd, ".vercel", "project.json")

  if (existsSync(projectJsonPath)) {
    console.log(pc.green("  Project already linked"))
  } else {
    const pkgPath = resolve(cwd, "package.json")
    let projectName = ""
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string
        }
        if (pkg.name) {
          projectName = pkg.name.replace(/^@[^/]+\//, "")
        }
      }
    } catch {
      // Malformed package.json — fall through with empty projectName
    }

    const linkParts = ["npx vercel link", "--yes"]
    if (projectName) {
      linkParts.push(`--project=${projectName}`)
    }
    if (vercelScope) {
      linkParts.push(`--scope=${vercelScope}`)
    }
    const linkCmd = linkParts.join(" ")

    console.log(
      pc.dim(
        `  Linking project ${projectName || "(unnamed)"} under scope ${vercelScope || "(default)"}...`,
      ),
    )
    try {
      execCmd(linkCmd, {
        inheritStderr: true,
      })
      console.log(pc.green("  Project linked"))
    } catch (err) {
      console.error(pc.red("Error: Failed to link project."))
      console.error(
        pc.dim(`  ${err instanceof Error ? err.message : String(err)}`),
      )
      console.error(pc.dim("  Try running: npx vercel link"))
      process.exit(1)
    }
  }

  // Step 3: Read env vars from .env.local.example
  console.log(pc.cyan("\n3. Configure environment variables"))
  const envExamplePath = resolve(cwd, ".env.local.example")
  const envVars = parseEnvExample(envExamplePath)
  const filteredVars = envVars.filter(v => v.name !== "TOOL_ENDPOINT")

  if (envVars.length === 0) {
    console.log(
      pc.yellow("  No .env.local.example found — skipping env var setup"),
    )
  } else {
    if (filteredVars.length === 0) {
      console.log(
        pc.dim("  Only TOOL_ENDPOINT found — it will be set automatically"),
      )
    } else {
      const existingEnvNames = fetchExistingEnvVars()

      for (const envVar of filteredVars) {
        if (existingEnvNames.has(envVar.name)) {
          console.log(pc.dim(`  ${envVar.name} already set, skipping`))
          continue
        }

        let value: string

        if (options.nonInteractive) {
          value = process.env[envVar.name] ?? ""
          if (!value) {
            console.error(
              pc.red(
                `Error: ${envVar.name} is required but not set in environment`,
              ),
            )
            process.exit(1)
          }
        } else {
          const clack = await import("@clack/prompts")
          const message = `${envVar.name}${envVar.comment ? pc.dim(` (${envVar.comment})`) : ""}:`
          const result = isSensitiveEnvVar(envVar.name)
            ? await clack.password({
                message,
                validate: v => (!v.trim() ? "Value is required" : undefined),
              })
            : await clack.text({
                message,
                placeholder: envVar.comment || undefined,
                validate: v => (!v.trim() ? "Value is required" : undefined),
              })
          if (clack.isCancel(result)) {
            clack.cancel("Cancelled")
            process.exit(0)
          }
          value = result
        }

        try {
          execCmd(`npx vercel env add ${envVar.name} production`, {
            input: value,
            silent: true,
          })
          console.log(pc.green(`  Set ${envVar.name}`))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes("already exists")) {
            console.log(pc.yellow(`  ${envVar.name} already exists, skipping`))
          } else {
            console.error(pc.red(`Error: Failed to set ${envVar.name}`))
            console.error(pc.dim(`  ${msg}`))
            console.error(
              pc.dim(
                `  Try manually: echo "value" | npx vercel env add ${envVar.name} production`,
              ),
            )
            process.exit(1)
          }
        }
      }
    }
  }

  // Step 5: First deploy
  console.log(pc.cyan("\n4. First deploy"))
  let deploymentUrl: string

  try {
    const output = execCmd("npx vercel deploy --prod", {
      inheritStderr: true,
    })
    const url = extractDeploymentUrl(output)
    if (!url) {
      console.error(
        pc.red("Error: Could not capture deployment URL from output."),
      )
      console.error(pc.dim("  Output was:"))
      console.error(pc.dim(`  ${output}`))
      process.exit(1)
    }
    deploymentUrl = url
    console.log(pc.green(`  Deployed to: ${deploymentUrl}`))
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const recovered = await tryRecoverDeployUrl(errMsg, cwd)
    if (recovered) {
      deploymentUrl = recovered
      console.log(
        pc.yellow(
          `  Warning: deploy exited non-zero but issued URL: ${deploymentUrl}`,
        ),
      )
    } else {
      console.error(pc.red("Error: First deploy failed."))
      console.error(pc.dim(`  ${errMsg}`))
      console.error(pc.dim("  Try running: npx vercel deploy --prod"))
      process.exit(1)
    }
  }

  // Step 6: Set TOOL_ENDPOINT
  console.log(pc.cyan("\n5. Set TOOL_ENDPOINT"))
  try {
    execCmd("npx vercel env add TOOL_ENDPOINT production", {
      input: deploymentUrl,
      silent: true,
    })
    console.log(pc.green(`  TOOL_ENDPOINT = ${deploymentUrl}`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("already exists")) {
      console.log(
        pc.yellow("  TOOL_ENDPOINT already exists, removing and updating..."),
      )
      try {
        execCmd("npx vercel env rm TOOL_ENDPOINT production --yes", {
          silent: true,
        })
        execCmd("npx vercel env add TOOL_ENDPOINT production", {
          input: deploymentUrl,
          silent: true,
        })
        console.log(pc.green(`  TOOL_ENDPOINT = ${deploymentUrl}`))
      } catch (rmErr) {
        console.error(pc.red("Error: Failed to update TOOL_ENDPOINT"))
        console.error(
          pc.dim(`  ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`),
        )
        console.error(
          pc.dim(
            "  Try manually: npx vercel env rm TOOL_ENDPOINT production --yes",
          ),
        )
        process.exit(1)
      }
    } else {
      console.error(pc.red("Error: Failed to set TOOL_ENDPOINT"))
      console.error(pc.dim(`  ${msg}`))
      console.error(
        pc.dim(
          `  Try manually: echo "${deploymentUrl}" | npx vercel env add TOOL_ENDPOINT production`,
        ),
      )
      process.exit(1)
    }
  }

  // Step 7: Redeploy with --force
  console.log(pc.cyan("\n6. Redeploy with updated env"))
  try {
    const output = execCmd("npx vercel deploy --prod --force", {
      inheritStderr: true,
    })
    const url = extractDeploymentUrl(output)
    if (url) {
      deploymentUrl = url
    }
    console.log(pc.green(`  Redeployed to: ${deploymentUrl}`))
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const recovered = await tryRecoverDeployUrl(errMsg, cwd)
    if (recovered) {
      deploymentUrl = recovered
      console.log(
        pc.yellow(
          `  Warning: redeploy exited non-zero but issued URL: ${deploymentUrl}`,
        ),
      )
    } else {
      console.error(pc.red("Error: Redeploy failed."))
      console.error(pc.dim(`  ${errMsg}`))
      console.error(pc.dim("  Try running: npx vercel deploy --prod --force"))
      process.exit(1)
    }
  }

  // Step 8: Verify
  console.log(pc.cyan("\n7. Verify deployment"))
  const manifestUrl = await deriveManifestUrl(deploymentUrl, cwd)

  if (!manifestUrl) {
    console.log(
      pc.yellow(
        "  Could not derive manifest URL automatically. Verify manually:",
      ),
    )
    console.log(
      pc.dim(
        `  npx @opensea/tool-sdk verify ${deploymentUrl}/.well-known/ai-tool/<slug>.json`,
      ),
    )
    return
  }

  console.log(pc.dim(`  Verifying ${manifestUrl}...`))

  try {
    const response = await fetch(manifestUrl, { redirect: "manual" })
    if (response.status !== 200) {
      console.error(
        pc.red(
          `Deploy succeeded but verification failed: HTTP ${response.status}`,
        ),
      )
      console.error(
        pc.dim(`  Check the manifest endpoint manually: ${manifestUrl}`),
      )
      process.exit(1)
    }

    const data = (await response.json()) as unknown
    const { validateManifest } = await import("../../lib/manifest/index.js")
    const result = validateManifest(data)

    if (!result.success) {
      console.error(pc.red("Deploy succeeded but manifest validation failed:"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    const manifest = result.data

    const manifestOrigin = new URL(manifestUrl).origin
    const endpointOrigin = new URL(manifest.endpoint).origin
    if (manifestOrigin !== endpointOrigin) {
      console.error(pc.red("Error: Origin mismatch (anti-impersonation check)"))
      console.error(pc.dim(`  Manifest served from: ${manifestOrigin}`))
      console.error(pc.dim(`  Endpoint origin: ${endpointOrigin}`))
      process.exit(1)
    }

    const { computeManifestHash } = await import("../../lib/onchain/hash.js")
    const hash = computeManifestHash(manifest)

    console.log(pc.green("\n  Deployment verified successfully!"))
    console.log(`  Name: ${manifest.name}`)
    console.log(`  Endpoint: ${manifest.endpoint}`)
    console.log(`  Manifest Hash: ${hash}`)
    console.log(`  URL: ${manifestUrl}`)
  } catch (err) {
    console.error(pc.red("Deploy succeeded but verification failed."))
    console.error(
      pc.dim(`  ${err instanceof Error ? err.message : String(err)}`),
    )
    console.error(
      pc.dim(`  Check the manifest endpoint manually: ${manifestUrl}`),
    )
    process.exit(1)
  }
}
