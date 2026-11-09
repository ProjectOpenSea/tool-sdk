import { readFileSync } from "node:fs"
import { defineConfig } from "tsdown"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string
}

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    target: "node18",
    fixedExtension: false,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: {
      index: "src/index.ts",
      "adapters/cloudflare": "src/lib/adapters/cloudflare.ts",
      "testing/index": "src/testing/index.ts",
    },
    format: ["esm"],
    dts: { sourcemap: true },
    clean: false,
    sourcemap: true,
    target: "node18",
    fixedExtension: false,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    onSuccess: "rm -rf dist/templates && cp -r src/templates dist/templates",
  },
])
