import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  execCmd,
  extractDeploymentUrl,
  isSensitiveEnvVar,
  parseEnvExample,
  tryRecoverDeployUrl,
} from "../cli/commands/deploy.js"

const fixturesDir = join(import.meta.dirname, "__fixtures_deploy__")

beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true })
})

afterAll(() => {
  rmSync(fixturesDir, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseEnvExample", () => {
  it("should parse env vars from a .env.local.example file", () => {
    const filePath = join(fixturesDir, ".env.local.example")
    writeFileSync(
      filePath,
      [
        "# This is a comment",
        "API_KEY=your-api-key-here",
        "SECRET_TOKEN=your-secret",
        "",
        "TOOL_ENDPOINT=https://example.vercel.app",
        "EMPTY_VAR=",
      ].join("\n"),
    )

    const vars = parseEnvExample(filePath)
    expect(vars).toEqual([
      { name: "API_KEY", comment: "your-api-key-here" },
      { name: "SECRET_TOKEN", comment: "your-secret" },
      { name: "TOOL_ENDPOINT", comment: "https://example.vercel.app" },
      { name: "EMPTY_VAR", comment: "" },
    ])
  })

  it("should return empty array for non-existent file", () => {
    const vars = parseEnvExample(join(fixturesDir, "nonexistent"))
    expect(vars).toEqual([])
  })

  it("should skip comment-only and blank lines", () => {
    const filePath = join(fixturesDir, ".env.comments")
    writeFileSync(filePath, "# comment\n\n# another comment\n")

    const vars = parseEnvExample(filePath)
    expect(vars).toEqual([])
  })

  it("should handle values containing equals signs", () => {
    const filePath = join(fixturesDir, ".env.equals")
    writeFileSync(
      filePath,
      "DATABASE_URL=postgres://user:pass@host/db?opt=val\n",
    )

    const vars = parseEnvExample(filePath)
    expect(vars).toEqual([
      {
        name: "DATABASE_URL",
        comment: "postgres://user:pass@host/db?opt=val",
      },
    ])
  })
})

describe("extractDeploymentUrl", () => {
  it("should extract a vercel.app URL from output", () => {
    const output = [
      "Vercel CLI 33.0.0",
      "Deploying...",
      "https://my-tool-abc123.vercel.app",
    ].join("\n")

    expect(extractDeploymentUrl(output)).toBe(
      "https://my-tool-abc123.vercel.app",
    )
  })

  it("should return undefined when no URL is found", () => {
    expect(extractDeploymentUrl("No URL here")).toBeUndefined()
  })

  it("should extract URL with path components", () => {
    const output = "https://my-project-hash.vercel.app"
    expect(extractDeploymentUrl(output)).toBe(
      "https://my-project-hash.vercel.app",
    )
  })

  it("should pick the first vercel.app URL", () => {
    const output = [
      "https://first-abc.vercel.app",
      "https://second-def.vercel.app",
    ].join("\n")

    expect(extractDeploymentUrl(output)).toBe("https://first-abc.vercel.app")
  })

  it("should extract URL from real Vercel CLI output with prefix", () => {
    const output = "✅  Production: https://my-project-abc123.vercel.app [3s]"
    expect(extractDeploymentUrl(output)).toBe(
      "https://my-project-abc123.vercel.app",
    )
  })
})

describe("isSensitiveEnvVar", () => {
  it.each([
    "OPENSEA_API_KEY",
    "ANTHROPIC_API_KEY",
    "MY_SECRET",
    "AUTH_TOKEN",
    "DB_PASSWORD",
    "WALLET_PRIVATE",
  ])("should return true for sensitive var %s", name => {
    expect(isSensitiveEnvVar(name)).toBe(true)
  })

  it.each([
    "CREATOR_ADDRESS",
    "TOOL_ENDPOINT",
    "DATABASE_URL",
    "NODE_ENV",
    "PORT",
    "KEYBOARD_LAYOUT",
  ])("should return false for non-sensitive var %s", name => {
    expect(isSensitiveEnvVar(name)).toBe(false)
  })

  it("should be case-insensitive", () => {
    expect(isSensitiveEnvVar("my_api_key")).toBe(true)
    expect(isSensitiveEnvVar("My_Secret")).toBe(true)
    expect(isSensitiveEnvVar("auth_token")).toBe(true)
  })

  it("should only match at the end of the name", () => {
    expect(isSensitiveEnvVar("SECRET_NAME")).toBe(false)
    expect(isSensitiveEnvVar("TOKEN_EXPIRY")).toBe(false)
    expect(isSensitiveEnvVar("PASSWORD_RESET_URL")).toBe(false)
    expect(isSensitiveEnvVar("RESET_TOKEN_COUNT")).toBe(false)
    expect(isSensitiveEnvVar("MY_SECRET_NAME")).toBe(false)
    expect(isSensitiveEnvVar("MY_KEY_STORE")).toBe(false)
  })
})

describe("execCmd", () => {
  it("should execute a simple command and return output", () => {
    const result = execCmd("echo hello", { silent: true })
    expect(result).toBe("hello")
  })

  it("should throw on command failure", () => {
    expect(() => execCmd("false", { silent: true })).toThrow()
  })

  it("should pass input via stdin", () => {
    const result = execCmd("cat", { input: "test-input", silent: true })
    expect(result).toBe("test-input")
  })
})

describe("tryRecoverDeployUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should return undefined when no URL in error message", async () => {
    const result = await tryRecoverDeployUrl(
      "Something went wrong",
      fixturesDir,
    )
    expect(result).toBeUndefined()
  })

  it("should return URL when manifest responds 200", async () => {
    const manifestDir = join(fixturesDir, "recover-200")
    mkdirSync(join(manifestDir, "src"), { recursive: true })
    writeFileSync(join(manifestDir, "src", "manifest.ts"), "")
    writeFileSync(
      join(manifestDir, "package.json"),
      JSON.stringify({ name: "my-tool" }),
    )

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }))

    const result = await tryRecoverDeployUrl(
      "Error: command exited with code 1\nhttps://my-tool-abc123.vercel.app\nsome other output",
      manifestDir,
    )
    expect(result).toBe("https://my-tool-abc123.vercel.app")
  })

  it("should return undefined when manifest responds non-200", async () => {
    const manifestDir = join(fixturesDir, "recover-404")
    mkdirSync(join(manifestDir, "src"), { recursive: true })
    writeFileSync(join(manifestDir, "src", "manifest.ts"), "")
    writeFileSync(
      join(manifestDir, "package.json"),
      JSON.stringify({ name: "my-tool" }),
    )

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }))

    const result = await tryRecoverDeployUrl(
      "Error: failed\nhttps://my-tool-abc123.vercel.app",
      manifestDir,
    )
    expect(result).toBeUndefined()
  })

  it("should return URL when manifest URL cannot be derived", async () => {
    const emptyDir = join(fixturesDir, "recover-no-manifest")
    mkdirSync(emptyDir, { recursive: true })

    const result = await tryRecoverDeployUrl(
      "Error: exit 1\nhttps://my-tool-abc123.vercel.app",
      emptyDir,
    )
    expect(result).toBe("https://my-tool-abc123.vercel.app")
  })

  it("should return undefined when fetch throws", async () => {
    const manifestDir = join(fixturesDir, "recover-fetch-err")
    mkdirSync(join(manifestDir, "src"), { recursive: true })
    writeFileSync(join(manifestDir, "src", "manifest.ts"), "")
    writeFileSync(
      join(manifestDir, "package.json"),
      JSON.stringify({ name: "my-tool" }),
    )

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    )

    const result = await tryRecoverDeployUrl(
      "Error: failed\nhttps://my-tool-abc123.vercel.app",
      manifestDir,
    )
    expect(result).toBeUndefined()
  })
})
