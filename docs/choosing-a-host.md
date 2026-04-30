# Choosing a Host

Your tool is a standard HTTP endpoint — any platform that can serve a `POST` request works. This guide compares the most common deployment targets and their trade-offs.

## Decision Matrix

| | Vercel Hobby | Vercel Pro | Cloudflare Workers Paid | Self-host (Express) |
|---|---|---|---|---|
| **Cost** | Free | $20/mo | $5/mo | You manage infra |
| **Max Duration** | 300 s (function) | 60 s default (configurable up to 300 s) | 30 s CPU time | Unlimited |
| **Edge** | No (regional) | No (regional) | Yes (global edge) | No (unless you add a CDN) |
| **Cold Start** | Minimal on production | Minimal on production | None (isolate model) | None (long-running process) |
| **Env Model** | `process.env` at module init | `process.env` at module init | `env` arg in `fetch(req, env)` | `process.env` at module init |

## Platform Details

### Vercel Hobby

- **Duration:** 300 s per function invocation — plenty for most tool handlers.
- **DX:** `npx vercel` deploys in seconds. Preview URLs on every push.
- **Limits:** 100 GB-hours/mo compute, 100 GB bandwidth, no team features.
- **Best for:** Solo developers, prototyping, low-traffic tools.

### Vercel Pro

- **Duration:** 60 s default, configurable up to 300 s via `maxDuration` in `vercel.json`.
- **DX:** Same as Hobby — git push deploys, preview URLs, logs dashboard.
- **Extras:** Team access, more bandwidth, analytics, Vercel Firewall.
- **Best for:** Production tools that need team collaboration or higher limits.

### Cloudflare Workers Paid

- **Duration:** 30 s CPU time (wall-clock time can be longer if waiting on I/O).
- **Edge:** Runs in 300+ locations. Sub-50 ms cold start via V8 isolate model.
- **Env model:** Environment variables are **not** available at module scope — they arrive as the second argument to `fetch(request, env)`. This requires a factory pattern for any code that needs env at init time (see [Migrating an Existing Tool](./migrating-existing-tool.md)).
- **Best for:** Latency-sensitive tools, global user bases, cost-conscious teams.

### Self-host (Express)

- **Duration:** Unlimited — you control the server process.
- **Control:** Full access to the filesystem, long-running connections, background jobs.
- **Trade-off:** You manage deployment, scaling, TLS, health checks, and uptime.
- **Best for:** Tools that need persistent state, long-running computations, or integration with internal services.

## Recommendations

1. **Starting out?** Use **Vercel Hobby**. Zero cost, generous limits, and the `init --template vercel` scaffold works out of the box.
2. **Need edge performance?** Use **Cloudflare Workers**. Lowest latency for globally distributed callers.
3. **Need long-running handlers?** Use **Self-host (Express)** or **Vercel Hobby** (300 s is usually enough).
4. **Team with existing Vercel org?** Use **Vercel Pro** for unified billing and team access.

All four targets are supported by `@opensea/tool-sdk` via framework adapters (`toVercelHandler`, `toCloudflareHandler`, `toExpressHandler`). The core handler logic (`createToolHandler`) is platform-agnostic — only the thin entry-point adapter changes between targets.

Predicate-gated tools work on all supported hosts. The `predicateGate` middleware is purely HTTP-header-based (it reads the `Authorization: SIWE ...` header and makes an onchain `tryHasAccess` staticcall), so it requires no platform-specific APIs or persistent state. See [predicate-gating-guide.md](predicate-gating-guide.md) for the full setup walkthrough.
