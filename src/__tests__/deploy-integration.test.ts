import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const fixturesDir = join(import.meta.dirname, "__fixtures_deploy_int__")

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, execSync: vi.fn() }
})

beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true })
})

afterAll(() => {
  rmSync(fixturesDir, { recursive: true, force: true })
})

describe("fetchExistingEnvVars", () => {
  let execSyncMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const cp = await import("node:child_process")
    execSyncMock = cp.execSync as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should return a set of existing env var names", async () => {
    execSyncMock.mockReturnValue(
      JSON.stringify([
        { key: "API_KEY" },
        { key: "SECRET_TOKEN" },
        { key: "TOOL_ENDPOINT" },
      ]),
    )

    const { fetchExistingEnvVars } = await import("../cli/commands/deploy.js")
    const result = fetchExistingEnvVars()

    expect(result).toBeInstanceOf(Set)
    expect(result.has("API_KEY")).toBe(true)
    expect(result.has("SECRET_TOKEN")).toBe(true)
    expect(result.has("TOOL_ENDPOINT")).toBe(true)
    expect(result.has("NONEXISTENT")).toBe(false)
  })

  it("should return empty set when vercel env ls fails", async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("Not authenticated")
    })

    const { fetchExistingEnvVars } = await import("../cli/commands/deploy.js")
    const result = fetchExistingEnvVars()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("should return empty set when vercel env ls returns invalid JSON", async () => {
    execSyncMock.mockReturnValue("not valid json")

    const { fetchExistingEnvVars } = await import("../cli/commands/deploy.js")
    const result = fetchExistingEnvVars()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("should return empty set for empty array response", async () => {
    execSyncMock.mockReturnValue("[]")

    const { fetchExistingEnvVars } = await import("../cli/commands/deploy.js")
    const result = fetchExistingEnvVars()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })
})

describe("deploy command (mocked shell)", () => {
  let execSyncMock: ReturnType<typeof vi.fn>
  let origCwd: string

  beforeEach(async () => {
    const cp = await import("node:child_process")
    execSyncMock = cp.execSync as ReturnType<typeof vi.fn>
    origCwd = process.cwd()
  })

  afterEach(() => {
    process.chdir(origCwd)
    vi.restoreAllMocks()
  })

  function setupExecMock(handlers: Record<string, string | Error>) {
    execSyncMock.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd)
      for (const [pattern, result] of Object.entries(handlers)) {
        if (cmdStr.includes(pattern)) {
          if (result instanceof Error) throw result
          return result
        }
      }
      return ""
    })
  }

  function setupTestDir(
    name: string,
    opts?: { envExample?: string; manifest?: string },
  ) {
    const testDir = join(fixturesDir, name)
    mkdirSync(join(testDir, ".vercel"), { recursive: true })
    writeFileSync(join(testDir, ".vercel", "project.json"), "{}")
    if (opts?.envExample) {
      writeFileSync(join(testDir, ".env.local.example"), opts.envExample)
    }
    if (opts?.manifest) {
      mkdirSync(join(testDir, "src"), { recursive: true })
      writeFileSync(join(testDir, "src", "manifest.ts"), opts.manifest)
    }
    return testDir
  }

  it("should reject unsupported host", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    const { deployCommand } = await import("../cli/commands/deploy.js")
    await expect(
      deployCommand.parseAsync(["--host", "aws"], { from: "user" }),
    ).rejects.toThrow(ExitError)
  })

  it("should exit with helpful message when vercel CLI is not available", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    setupExecMock({
      "vercel --version": new Error("command not found: vercel"),
    })

    const { deployCommand } = await import("../cli/commands/deploy.js")
    await expect(
      deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Vercel CLI is not available"),
    )
  })

  it("should exit with helpful message when not logged in", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": new Error("Not authenticated"),
    })

    const { deployCommand } = await import("../cli/commands/deploy.js")
    await expect(
      deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Not logged in to Vercel"),
    )
  })

  it("should handle first deploy failure", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    const testDir = setupTestDir("deploy-fail")

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel deploy --prod": new Error("Build failed"),
    })

    process.chdir(testDir)

    const { deployCommand } = await import("../cli/commands/deploy.js")
    await expect(
      deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("First deploy failed"),
    )
  })

  it("should handle missing .env.local.example with warning", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("no-env")

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel deploy --prod": new Error("Build failed"),
    })

    process.chdir(testDir)

    const { deployCommand } = await import("../cli/commands/deploy.js")
    await expect(
      deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
    ).rejects.toThrow(ExitError)

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipping env var setup"),
    )
  })

  it("should exit non-zero when verification fails after deploy", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("verify-fail", {
      manifest: `export const manifest = { name: "my-tool" }`,
    })

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel env add": "",
      "vercel deploy --prod --force": "https://my-tool-final.vercel.app",
      "vercel deploy --prod": "https://my-tool-abc123.vercel.app",
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }))

    process.chdir(testDir)

    try {
      const { deployCommand } = await import("../cli/commands/deploy.js")
      await expect(
        deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
      ).rejects.toThrow(ExitError)

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("verification failed"),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("should exit non-zero on origin mismatch during verification", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("origin-mismatch", {
      manifest: `export const manifest = { name: "my-tool" }`,
    })

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel env add": "",
      "vercel deploy --prod --force": "https://my-tool-final.vercel.app",
      "vercel deploy --prod": "https://my-tool-abc123.vercel.app",
    })

    const mismatchManifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "my-tool",
      description: "A test tool",
      endpoint: "https://evil-site.example.com",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(mismatchManifest), { status: 200 }),
      )

    process.chdir(testDir)

    try {
      const { deployCommand } = await import("../cli/commands/deploy.js")
      await expect(
        deployCommand.parseAsync(["--host", "vercel"], { from: "user" }),
      ).rejects.toThrow(ExitError)

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Origin mismatch"),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("should complete happy path with successful verification", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("happy-full", {
      envExample: "API_KEY=your-key\nTOOL_ENDPOINT=auto\n",
      manifest: `export const manifest = { name: "my-tool" }`,
    })

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel env add": "",
      "vercel deploy --prod --force": "https://my-tool-final.vercel.app",
      "vercel deploy --prod": "https://my-tool-abc123.vercel.app",
    })

    const validManifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "my-tool",
      description: "A test tool",
      endpoint: "https://my-tool-final.vercel.app",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(validManifest), { status: 200 }),
      )

    process.chdir(testDir)

    // Set env var for non-interactive mode
    const origApiKey = process.env.API_KEY
    process.env.API_KEY = "test-key-value"

    try {
      const { deployCommand } = await import("../cli/commands/deploy.js")
      await deployCommand.parseAsync(
        ["--host", "vercel", "--non-interactive"],
        { from: "user" },
      )

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Deployment verified"),
      )
    } finally {
      globalThis.fetch = originalFetch
      if (origApiKey === undefined) {
        delete process.env.API_KEY
      } else {
        process.env.API_KEY = origApiKey
      }
    }
  })

  it("should skip env var prompts for vars already set in Vercel", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("skip-existing", {
      envExample: "API_KEY=your-key\nSECRET=your-secret\nTOOL_ENDPOINT=auto\n",
      manifest: `export const manifest = { name: "my-tool" }`,
    })

    setupExecMock({
      "vercel --version": "Vercel CLI 33.0.0",
      "vercel whoami": "test-user",
      "vercel env ls": JSON.stringify([{ key: "API_KEY" }]),
      "vercel env add": "",
      "vercel deploy --prod --force": "https://my-tool-final.vercel.app",
      "vercel deploy --prod": "https://my-tool-abc123.vercel.app",
    })

    const validManifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "my-tool",
      description: "A test tool",
      endpoint: "https://my-tool-final.vercel.app",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(validManifest), { status: 200 }),
      )

    process.chdir(testDir)

    const origSecret = process.env.SECRET
    process.env.SECRET = "secret-value"

    try {
      const { deployCommand } = await import("../cli/commands/deploy.js")
      await deployCommand.parseAsync(
        ["--host", "vercel", "--non-interactive"],
        { from: "user" },
      )

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("API_KEY already set, skipping"),
      )

      expect(execSyncMock).not.toHaveBeenCalledWith(
        expect.stringContaining("env add API_KEY"),
        expect.anything(),
      )

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Set SECRET"))
    } finally {
      globalThis.fetch = originalFetch
      if (origSecret === undefined) {
        delete process.env.SECRET
      } else {
        process.env.SECRET = origSecret
      }
    }
  })

  it("should fall through to prompt flow when vercel env ls fails", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    const testDir = setupTestDir("env-ls-fail", {
      envExample: "API_KEY=your-key\nTOOL_ENDPOINT=auto\n",
      manifest: `export const manifest = { name: "my-tool" }`,
    })

    execSyncMock.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd)
      if (cmdStr.includes("vercel env ls")) throw new Error("Network error")
      if (cmdStr.includes("vercel --version")) return "Vercel CLI 33.0.0"
      if (cmdStr.includes("vercel whoami")) return "test-user"
      if (cmdStr.includes("vercel env add")) return ""
      if (cmdStr.includes("vercel deploy --prod --force"))
        return "https://my-tool-final.vercel.app"
      if (cmdStr.includes("vercel deploy --prod"))
        return "https://my-tool-abc123.vercel.app"
      return ""
    })

    const validManifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "my-tool",
      description: "A test tool",
      endpoint: "https://my-tool-final.vercel.app",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(validManifest), { status: 200 }),
      )

    process.chdir(testDir)

    const origApiKey = process.env.API_KEY
    process.env.API_KEY = "test-key-value"

    try {
      const { deployCommand } = await import("../cli/commands/deploy.js")
      await deployCommand.parseAsync(
        ["--host", "vercel", "--non-interactive"],
        { from: "user" },
      )

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not fetch existing env vars"),
      )

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Set API_KEY"),
      )
    } finally {
      globalThis.fetch = originalFetch
      if (origApiKey === undefined) {
        delete process.env.API_KEY
      } else {
        process.env.API_KEY = origApiKey
      }
    }
  })
})
