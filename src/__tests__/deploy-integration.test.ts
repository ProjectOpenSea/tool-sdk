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
})
