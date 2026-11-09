import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The built CLI reads templates from dist/templates; from source, init.ts
// resolves them next to itself, where none exist. Redirect those reads to
// src/templates so the real action scaffolds real files.
const paths = vi.hoisted(() => {
  const dir = (relative: string) =>
    decodeURIComponent(new URL(relative, import.meta.url).pathname)
  return {
    bundled: dir("../cli/commands/templates"),
    source: dir("../templates"),
  }
})

vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>()
  const redirect = <T>(p: T): T =>
    typeof p === "string" && p.startsWith(paths.bundled)
      ? (`${paths.source}${p.slice(paths.bundled.length)}` as T)
      : p
  return {
    ...fs,
    existsSync: (p: string) => fs.existsSync(redirect(p)),
    readdirSync: (p: string) => fs.readdirSync(redirect(p)),
    statSync: (p: string) => fs.statSync(redirect(p)),
    readFileSync: (p: string, enc: BufferEncoding) =>
      fs.readFileSync(redirect(p), enc),
  }
})

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  text: vi.fn(),
  select: vi.fn(),
}))
vi.mock("@clack/prompts", () => prompts)

const { initCommand } = await import("../cli/commands/init.js")

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "tool-sdk-init-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("__VERSION__", "0.0.0-test")
  for (const fn of Object.values(prompts)) fn.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(cwd, { recursive: true, force: true })
})

const scaffolded = (name: string, file: string) =>
  readFileSync(join(cwd, name, file), "utf-8")

describe("tool-sdk init", () => {
  it("scaffolds vercel defaults without prompting when --no-interactive is passed", async () => {
    await initCommand.parseAsync(["ci-tool", "--no-interactive"], {
      from: "user",
    })

    expect(prompts.intro).not.toHaveBeenCalled()
    expect(prompts.text).not.toHaveBeenCalled()
    expect(prompts.select).not.toHaveBeenCalled()
    expect(existsSync(join(cwd, "ci-tool", "vercel.json"))).toBe(true)
    expect(scaffolded("ci-tool", "public/llms.txt")).toContain("A ci-tool tool")
    expect(scaffolded("ci-tool", "public/llms.txt")).toContain(
      "0x0000000000000000000000000000000000000000",
    )
  })

  it("prompts and scaffolds the chosen answers without the flag", async () => {
    prompts.text
      .mockResolvedValueOnce("Answers questions")
      .mockResolvedValueOnce("0x1111111111111111111111111111111111111111")
      .mockResolvedValueOnce("https://asked-tool.example.com")
    prompts.select.mockResolvedValueOnce("vercel")

    await initCommand.parseAsync(["asked-tool"], { from: "user" })

    expect(prompts.intro).toHaveBeenCalledOnce()
    expect(prompts.select).toHaveBeenCalledOnce()
    expect(scaffolded("asked-tool", "public/llms.txt")).toContain(
      "Answers questions",
    )
    expect(scaffolded("asked-tool", "public/llms.txt")).toContain(
      "0x1111111111111111111111111111111111111111",
    )
  })
})
