import { readFileSync } from "node:fs"
import { defineConfig } from "tsup"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string
}

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    clean: true,
    sourcemap: true,
    target: "node18",
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
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "node18",
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    onSuccess: "rm -rf dist/templates && cp -r src/templates dist/templates",
  },
])
