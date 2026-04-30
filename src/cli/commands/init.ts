import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import pc from "picocolors"
import { deriveSlug } from "../../lib/utils.js"

interface InitOptions {
  noInteractive?: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))

function getTemplatesDir(): string {
  return resolve(__dirname, "templates")
}

function substituteTemplate(
  content: string,
  vars: Record<string, string>,
): string {
  let result = content
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  return result
}

function copyTemplateDir(
  srcDir: string,
  destDir: string,
  vars: Record<string, string>,
): void {
  if (!existsSync(srcDir)) return
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry)
    const destPath = join(destDir, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyTemplateDir(srcPath, destPath, vars)
    } else {
      const content = readFileSync(srcPath, "utf-8")
      writeFileSync(destPath, substituteTemplate(content, vars))
    }
  }
}

export const initCommand = new Command("init")
  .description("Scaffold a new ERC-XXXX tool project")
  .argument("[name]", "Tool name")
  .option("--no-interactive", "Skip interactive prompts (uses defaults)")
  .action(async (nameArg: string | undefined, options: InitOptions) => {
    let name: string
    let description: string
    let creatorAddress: string
    let hosting: string
    let endpoint: string

    if (options.noInteractive) {
      name = nameArg ?? "my-tool"
      description = `A ${name} tool`
      creatorAddress = "0x0000000000000000000000000000000000000000"
      hosting = "vercel"
      endpoint = `https://${name}.vercel.app`
    } else {
      const clack = await import("@clack/prompts")
      clack.intro(pc.cyan("Create a new ERC-XXXX Tool"))

      if (nameArg) {
        name = nameArg
      } else {
        const nameResult = await clack.text({
          message: "Tool name:",
          placeholder: "my-tool",
          validate: v => (v.length === 0 ? "Name is required" : undefined),
        })
        if (clack.isCancel(nameResult)) {
          clack.cancel("Cancelled")
          process.exit(0)
        }
        name = nameResult
      }

      const descResult = await clack.text({
        message: "Description:",
        placeholder: "A useful AI agent tool",
      })
      if (clack.isCancel(descResult)) {
        clack.cancel("Cancelled")
        process.exit(0)
      }
      description = descResult

      const addrResult = await clack.text({
        message: "Creator address (0x...):",
        placeholder: "0x0000000000000000000000000000000000000000",
        validate: v =>
          /^0x[0-9a-fA-F]{40}$/.test(v)
            ? undefined
            : "Must be a valid EVM address",
      })
      if (clack.isCancel(addrResult)) {
        clack.cancel("Cancelled")
        process.exit(0)
      }
      creatorAddress = addrResult

      const hostingResult = await clack.select({
        message: "Hosting platform:",
        options: [
          { value: "vercel", label: "Vercel" },
          { value: "cloudflare", label: "Cloudflare Workers" },
          { value: "express", label: "Express" },
        ],
      })
      if (clack.isCancel(hostingResult)) {
        clack.cancel("Cancelled")
        process.exit(0)
      }
      hosting = hostingResult as string

      const endpointResult = await clack.text({
        message: "Tool endpoint URL:",
        placeholder: `https://${name}.vercel.app`,
      })
      if (clack.isCancel(endpointResult)) {
        clack.cancel("Cancelled")
        process.exit(0)
      }
      endpoint = endpointResult

      clack.outro(pc.green("Scaffolding project..."))
    }

    const slug = deriveSlug(name)
    const outDir = resolve(process.cwd(), name)

    if (!outDir.startsWith(process.cwd() + sep)) {
      console.error(
        pc.red("Error: tool name must not escape the current directory"),
      )
      process.exit(1)
    }

    const templatesDir = getTemplatesDir()
    const templateDir = join(templatesDir, hosting)

    const vars: Record<string, string> = {
      TOOL_NAME: name,
      TOOL_SLUG: slug,
      TOOL_DESCRIPTION: description,
      CREATOR_ADDRESS: creatorAddress,
      TOOL_ENDPOINT: endpoint ?? `https://${name}.vercel.app`,
    }

    copyTemplateDir(templateDir, outDir, vars)

    console.log(pc.green(`\nProject scaffolded at ./${name}/\n`))
    console.log("Next steps:")
    console.log(`  cd ${name}`)
    console.log("  npm install")
    console.log("  # Edit src/manifest.ts and src/handler.ts")
    if (hosting === "vercel") {
      console.log("  npx vercel dev")
    } else if (hosting === "cloudflare") {
      console.log("  npx wrangler dev")
    } else {
      console.log("  npm run dev")
    }
    console.log(`\n  npx @opensea/tool-sdk validate ./src/manifest.ts`)
    console.log(
      `  npx @opensea/tool-sdk register --metadata <url> --network base`,
    )
  })
