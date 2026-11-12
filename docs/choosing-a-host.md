# Choosing a host

A tool is a plain HTTP endpoint, so any platform that can serve a `POST` request works. This page compares the common targets.

## Decision matrix

| | Vercel Hobby | Vercel Pro | Cloudflare Workers Paid | Self-host (Express) |
|---|---|---|---|---|
| **Cost** | Free | $20/mo | $5/mo | You manage infra |
| **Max Duration** | 300 s (function) | 60 s default (configurable up to 300 s) | 30 s CPU time | Unlimited |
| **Edge** | No (regional) | No (regional) | Yes (global edge) | No (unless you add a CDN) |
| **Cold Start** | Minimal on production | Minimal on production | None (isolate model) | None (long-running process) |
| **Env Model** | `process.env` at module init | `process.env` at module init | `env` arg in `fetch(req, env)` | `process.env` at module init |

## Platform details

### Vercel Hobby

- 300 s per function invocation, enough for most tool handlers.
- `npx vercel` deploys in seconds, with a preview URL on every push.
- Limits: 100 GB-hours/mo compute, 100 GB bandwidth, no team features.
- Fits solo developers, prototypes, and low-traffic tools.

### Vercel Pro

- 60 s default, configurable up to 300 s with `maxDuration` in `vercel.json`.
- Same workflow as Hobby: git push deploys, preview URLs, a logs dashboard.
- Adds team access, more bandwidth, analytics, and Vercel Firewall.
- Fits production tools that need team access or higher limits.

### Cloudflare Workers Paid

- 30 s of CPU time. Wall-clock time can run longer while waiting on I/O.
- Runs in 300+ locations, with sub-50 ms cold starts from the V8 isolate model.
- Environment variables are **not** available at module scope. They arrive as the second argument to `fetch(request, env)`, so any code that needs env at init time has to use a factory (see [Migrating an existing tool](./migrating-existing-tool.md)).
- Fits latency-sensitive tools, global callers, and tight budgets.

### Self-host (Express)

- No duration limit: you own the server process.
- Full access to the filesystem, long-lived connections, and background jobs.
- You also own deployment, scaling, TLS, health checks, and uptime.
- Fits tools that need persistent state, long computations, or access to internal services.

## Recommendations

1. Starting out: use Vercel Hobby. It is free, and the `init --template vercel` scaffold works as generated.
2. Callers spread across the world: use Cloudflare Workers for the lowest latency.
3. Long-running handlers: self-host with Express, or use Vercel Hobby if 300 s is enough.
4. A team that already has a Vercel org: use Vercel Pro for shared billing and team access.

`@opensea/tool-sdk` supports all four through adapters (`toVercelHandler`, `toCloudflareHandler`, `toExpressHandler`). The handler built by `createToolHandler` is platform-agnostic; only the entry-point adapter changes between targets.

Predicate-gated tools run on every supported host. The `predicateGate` middleware works from HTTP headers alone: it reads the `X-Payment` header, recovers the caller with `ecrecover`, and makes an onchain `tryHasAccess` staticcall. It needs no platform-specific APIs or persistent state. See [predicate-gating-guide.md](predicate-gating-guide.md) for setup.
