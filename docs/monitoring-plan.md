# NextNode Monitoring — Implementation Plan

> **Purpose**: single source of truth for building `@nextnode-solutions/monitoring`,
> a multi-tenant monitoring stack deployed on a dedicated Hetzner VPS that watches
> every NextNode production project and backs a competition-grade client SLA.
>
> **Audience**: future Claude sessions + the human author. Read this end-to-end
> before touching any code in `packages/monitoring/`. Every architectural choice
> below is LOCKED — do not re-litigate unless explicitly asked.

---

## Status tracker

| Phase | Scope | Status |
|---|---|---|
| **Phase 1 — Foundation** | Package scaffold + `nextnode.toml` schema | `[DONE]` |
| **Phase 2 — Core services** | Auth, Hono ingest, uptime probes | `[TODO]` |
| **Phase 3 — Alerting** | SLO rule generator, alert routing | `[TODO]` |
| **Phase 4 — Deployment** | Docker Compose + Cloudflare Worker second probe | `[TODO]` |
| **Phase 5 — Extended features** | Synthetic tests, status page, client contract | `[TODO]` |

**Current step**: Phase 2 / Step 4 — Hono ingest service (MVP)
**Last updated**: 2026-04-11

---

## 1. What we're building

A self-hosted multi-tenant monitoring service that:

1. Ingests logs from every NextNode production project via `@nextnode-solutions/logger`'s
   HTTP transport, with per-project auth tokens and 30-day retention
2. Probes every client app's `/health` endpoint every 5 seconds from an external VPS
   (plus a free Cloudflare Worker from a second geographic location)
3. Scrapes Prometheus-format `/metrics` from each client app for RED-method
   (Rate / Errors / Duration) and golden-signals monitoring
4. Auto-generates SLO-based alert rules from each project's declared `[monitoring.slo]`
   block in its `nextnode.toml`, using multi-window multi-burn-rate alerting
   per the Google SRE workbook
5. Routes alerts (page vs ticket) to the right channels, deduplicates, stores
   incident history, exposes a public status page per client
6. Supports a dead-man's switch so a crashed monitor pages the operator within 1 minute

The service backs a commercial guarantee to NextNode clients: declared SLO
(e.g. 99.9% availability, p95 < 500ms over 30 days), public status page,
monthly SLO compliance report, incident response SLA.

---

## 2. Architecture decisions — LOCKED

Every decision in this section is the result of an explicit discussion. Do not
change without raising the question first.

### 2.1 Deployment model: SINGLE SHARED MULTI-TENANT VPS

**Decision**: one monitoring VPS watches every NextNode project via labels-based
multi-tenancy. NOT one VPS per project.

**Rationale**:
- Economics: 10 projects = €6.49/mo shared vs €64.90/mo per-project (10×)
- Scales to 30–50 projects on a single CX33 before needing a bigger tier
- Enables a "command center" view across all projects (impossible per-project)
- Matches how every commercial monitoring service works (Datadog, Grafana Cloud, BetterStack)
- Ops simplicity: one compose file, one backup, one set of credentials

**Upgrade path for enterprise clients**: a client requiring physical isolation
(banking, healthcare, regulated industry) can be moved to a dedicated instance
(CCX13 @ €15.99/mo). Only the `endpoint` in their `nextnode.toml` changes; zero
code changes required.

### 2.2 Server: Hetzner CX33 @ €6.49/mo

**Decision**: Hetzner Cloud CX33 in an EU datacenter (Nuremberg or Falkenstein).

| Spec | Value |
|---|---|
| vCPU | 4 (Intel/AMD shared) |
| RAM | 8 GB |
| Disk | 80 GB NVMe |
| Traffic | 20 TB/month included |
| Location | EU (Nuremberg/Falkenstein) |
| Price | €6.49/mo + ~€0.50/mo IPv4 ≈ **€7/mo** |

**Why not alternatives** (checked on 2026-04-10 from live Hetzner pricing):
- **CX23** (€3.99/mo, 4 GB RAM) — too tight, stack needs ~1.5 GB under load with
  zero headroom
- **CAX21** (€7.99/mo, ARM) — €1.50/mo more than CX33 for identical specs, plus
  occasional Docker image friction
- **CPX32** (€13.99/mo) — 160 GB disk is 2× what we need; pay only if extending
  retention beyond 30 days
- **CCX13** (€15.99/mo, dedicated) — only 2 vCPU vs CX33's 4; reserve for the
  enterprise-client upsell tier
- **Hetzner US/Singapore locations** — only 1 TB/month traffic (vs 20 TB EU);
  do NOT use

**Growth path**: resize in place to CX43 (€11.99) or CX53 (€22.49) without rebuild
when tenant count or disk pressure justifies.

### 2.3 Tech stack: VictoriaMetrics family + Grafana + custom Hono service

**Decision**: consolidate under the VictoriaMetrics ecosystem + one TypeScript service.

| Component | Role | Why this, not alternatives |
|---|---|---|
| **VictoriaMetrics** (`vmsingle`) | Scrape `/metrics`, store time series, evaluate MetricsQL | Drop-in Prometheus replacement, PromQL-compatible, single Go binary, ~50–150 MB RAM idle. Way lighter than Prometheus. |
| **VictoriaLogs** | Store logs, 30-day retention (`-retentionPeriod=30d`) | Single Go binary, `/insert/jsonline` ndjson endpoint maps cleanly to `@nextnode-solutions/logger`'s HTTP transport. Much simpler than Loki (no schema_config, no object storage). |
| **vmalert** | Evaluate recording + alerting rules against VM and VL, fire webhooks | Replaces Prometheus rule evaluator AND Alertmanager's rule half. Ships webhook notifier — no Alertmanager config DSL needed. |
| **Grafana** | Dashboards, ad-hoc query explorer for VM and VL | Industry standard, first-class datasources for both VM and VL. Worth the ~200 MB RAM to avoid building dashboards ourselves. |
| **`@nextnode-solutions/monitoring`** (Hono) | Log ingest endpoint, 5s probe worker, token CLI, webhook receiver from vmalert, status page | The TypeScript service that makes this ours. Handles multi-tenancy, auth, rate limiting, notification routing, incident tracking. |

**Killed from the design**:
- ❌ Prometheus — replaced by VictoriaMetrics
- ❌ Alertmanager — replaced by vmalert webhook → Hono routing
- ❌ Loki — rejected in favor of VictoriaLogs (simpler storage, better single-node story)
- ❌ `blackbox_exporter` — our own 5s worker covers it with better tenant awareness
- ❌ Uptime Kuma — 20s minimum interval, Socket.IO-first API, doesn't fit

### 2.4 Second probe location: Cloudflare Worker (free tier)

**Decision**: a Cloudflare Worker with a cron trigger probes every tenant's
`/health` endpoint AND the monitoring VPS itself (dead-man's switch).

**Why**:
- Single-probe setups are blind to the probe's own datacenter outage — you'd
  measure the monitoring VPS from itself, which is epistemically useless for an
  SLA guarantee
- Free tier: 100k requests/day, 3 cron triggers, no card required
- A failed probe is only "real" when both probes (Hetzner + CF) agree, which
  kills false positives from single-region network glitches
- The dead-man's switch is the ONLY thing that catches a crashed monitoring VPS.
  Without it a silent crash = "all green" for your SLA = your guarantee is worthless

**Cost**: €0. Budget headroom: 1440 req/day × 50 tenants = 72k req/day. Fine until ~70 tenants.

### 2.5 Package location: `packages/monitoring/`, NEVER published to npm

**Decision**: new workspace package under `packages/monitoring/`, following the
exact same pattern as `packages/infrastructure/` (private, consumed directly
from the monorepo by deploy pipelines, no `publishConfig`).

**Why**:
- Direct workspace consumption of `@nextnode-solutions/logger` — the HTTP transport
  at `packages/logger/src/transports/http.ts` is the other end of our ingest endpoint
- Reuse of `@nextnode-solutions/infrastructure` config schema — `nextnode.toml`
  already parses here; we extend it with `[monitoring]` blocks
- Consistent standards (oxlint, oxfmt, vitest via `@nextnode-solutions/standards`)
- Single CI pipeline via the existing `pipeline.yml`
- Atomic changes: logger wire format + ingest endpoint evolve together

### 2.6 Strict layered architecture (mirrors `packages/infrastructure`)

Absolute ban on mixing layers. Copy the architecture from
`packages/infrastructure/CLAUDE.md` verbatim:

```
src/
  index.ts            — THIN entry: argv parsing + dispatch only
  cli/                — Command orchestrators (read env, call domain + adapters)
  domain/             — PURE business logic. NO IO, NO env, NO logger, NO mocks needed
  adapters/           — IO boundary: fs, fetch, SQLite, HTTP server, VM/VL clients
  config/             — Schema + loader (self-contained, only stdlib + smol-toml)
```

**Layer import rules**:
- `index.ts` → only `./cli/commands`
- `cli/*` → `domain/`, `adapters/`, `config/`, logger
- `domain/*` → other `domain/*`, `config/schema` (types only)
- `adapters/*` → `config/schema` (types), `domain/*` (types only)
- `config/*` → stdlib + `smol-toml` only

Violations are bugs, not style. See `packages/infrastructure/CLAUDE.md` for the
full ruleset.

### 2.7 Multi-tenancy: labels + auth tokens

**Decision**: every log, metric, and alert carries `client_id`, `project`,
`environment` labels. Per-project auth tokens are the tenant identity.

- Labels are **injected server-side** by the Hono ingest service after token
  lookup — clients cannot spoof their project
- Every metric scraped by VictoriaMetrics is relabelled with the same set from
  scrape config
- Grafana orgs/folders can be used later to give clients read-only self-service
  access to their own data (NOT in v1)

### 2.8 Secrets: tokens NEVER in `nextnode.toml`

**Decision**: auth tokens are secrets and live in GitHub repo secrets + runtime
env vars, never in the toml config.

**Flow**:
1. Admin runs `nn-monitor token create --client foo --project foo-app` on the monitoring VPS
2. CLI prints the token ONCE (`nn_live_xxx`), hashes it, stores hash in the monitoring DB
3. Admin stores the plaintext token in the client repo as a GitHub secret: `NEXTNODE_MONITORING_TOKEN`
4. Deploy pipeline injects it as an env var on the client app VPS
5. `@nextnode-solutions/logger`'s HTTP transport reads it from `process.env` at startup
6. Every request to the ingest endpoint carries `Authorization: Bearer nn_live_xxx`
7. Hono service hashes incoming token, constant-time compares against stored hash,
   resolves to `{client_id, project, tier}`, injects labels

**Security properties**:
- Token is shown ONCE (Stripe/GitHub style)
- Only hash lives in the DB → leaked DB dumps cannot authenticate
- Blast radius of a leaked token = one project
- Rotation is trivial: new token → update GitHub secret → re-deploy → revoke old

### 2.9 SLO methodology — Google SRE multi-window multi-burn-rate

**Decision**: every tenant declares an SLO in `nextnode.toml`. The monitoring
service auto-generates vmalert rules following the Google SRE workbook's
multi-window multi-burn-rate technique.

**Why**:
- Single source of truth for the client guarantee
- Alerts fire on **symptoms** (SLO burn) not **causes** (CPU%, RAM%) — per SRE book
- Two alert tiers mapped directly to business impact:
  - **Page**: burn rate ≥ 14.4 over 1h AND ≥ 6 over 6h (fast-burn, wake someone up)
  - **Ticket**: burn rate ≥ 1 over 3d (slow erosion, look in the morning)
- Mathematically-derived detection time, not arbitrary thresholds
- Client-facing: the error budget burn is the story you sell

See `docs/audit-merged.md` for any existing infrastructure context; see
https://sre.google/workbook/alerting-on-slos for the canonical methodology.

### 2.10 Golden signals + black-box AND white-box

**Decision**: monitor the four golden signals (Latency, Traffic, Errors,
Saturation) using both black-box (external probe) and white-box (internal
`/metrics` scrape) per the SRE book's *Monitoring Distributed Systems* chapter.

- **Black-box**: 5s uptime probe from Hetzner monitoring VPS + 1m probe from
  Cloudflare Worker. Catches symptoms, represents user experience.
- **White-box**: Prometheus-format `/metrics` endpoint on every client app,
  scraped every 15s. Exposes RED counters + histograms, catches imminent failures
  masked by retries, memory leaks before OOM, queue backpressure before latency rises.

**Both are mandatory.** Black-box alone misses early warning; white-box alone
trusts the system to tell the truth about itself. Combine heavily.

---

## 3. Target architecture

```
┌──────────── Hetzner CX33 (monitoring VPS, Nuremberg) ───────────────┐
│  docker-compose.yml — managed via packages/monitoring/deploy/       │
│                                                                      │
│  ┌───────────────┐  scrape /metrics   ┌──────────────────────┐      │
│  │VictoriaMetrics│◄────── every 15s ──┤ Client app VPSes     │      │
│  │  :8428        │                    │ (multiple projects)  │      │
│  └──────┬────────┘                    │ on Hetzner/Cloudflare│      │
│         │                             └──────────┬───────────┘      │
│         │ query                                  │                  │
│         ▼                                        │ 5s HTTP probe    │
│  ┌───────────────┐                   ┌───────────┴──────────┐       │
│  │ vmalert       │ webhook on fire ─►│ Hono monitoring svc  │       │
│  │  :8880        │                   │  :3000 — Caddy TLS   │       │
│  └───────────────┘                   │                      │       │
│                                      │ - POST /ingest/logs  │       │
│  ┌───────────────┐ ndjson POST       │ - GET  /status/:p    │       │
│  │ VictoriaLogs  │◄──────────────────┤ - POST /webhook/vmalert│     │
│  │  :9428        │                   │ - 5s uptime worker   │       │
│  └──────┬────────┘                   │ - synthetic tests    │       │
│         │                            │ - SQLite: tokens,    │       │
│         │ query                      │   incidents, tenants │       │
│         ▼                            └──────────┬───────────┘       │
│  ┌───────────────┐                              ▲                   │
│  │ Grafana       │                              │ heartbeat         │
│  │  :3001        │                              │                   │
│  └───────────────┘                   ┌──────────┴──────────┐        │
│                                      │ Cloudflare Worker   │ FREE   │
│                                      │ (2nd probe + DMS)   │        │
│                                      │ - cron trigger 1min │        │
│                                      │ - probes all targets│        │
│                                      │ - probes monitoring │        │
│                                      │   VPS itself (DMS)  │        │
│                                      └─────────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
           ▲
           │ HTTPS (Caddy auto-TLS, single public port)
           │
      Client apps ─ logger HTTP transport + /metrics endpoint
      Operator    ─ Grafana dashboards, status pages
```

---

## 4. `nextnode.toml` schema — the contract

Every NextNode project adds these blocks to its `nextnode.toml` to opt into
monitoring. All fields except `[monitoring.endpoint]` are optional with sensible
defaults.

```toml
[monitoring]
# Required: where to send logs and query status.
# Default: shared nextnode instance. Override for enterprise-dedicated tier.
endpoint = "https://monitoring.nextnode.fr"

# Token is NOT here. Injected via env var NEXTNODE_MONITORING_TOKEN.
# Stored as a GitHub repo secret, pushed to the app VPS at deploy time.

[monitoring.slo]
# The promise to the client. Drives auto-generated vmalert rules.
availability   = 99.9   # % of requests that must succeed (2xx/3xx)
latency_ms_p95 = 500    # p95 latency ceiling (successful requests only)
latency_ms_p99 = 1500   # p99 latency ceiling (optional)
window_days    = 30     # rolling measurement window

[monitoring.healthcheck]
# The 5s black-box probe target on this app.
path             = "/health"  # endpoint to poll
interval_seconds = 5          # poll frequency
timeout_ms       = 2000       # max wait before "down"
expected_status  = 200        # HTTP status for "up"
```

**Schema types live in `packages/infrastructure/src/config/schema.ts`** (single
source of truth for `nextnode.toml`). The monitoring package imports them as
types only per the layer rules.

---

## 5. Cost breakdown

| Item | Monthly | Notes |
|---|---|---|
| Hetzner CX33 (monitoring VPS, EU) | €6.49 | 4 vCPU, 8 GB RAM, 80 GB NVMe, 20 TB traffic |
| Primary IPv4 | ~€0.50 | Standard Hetzner surcharge |
| Cloudflare Worker (second probe + DMS) | €0 | Free tier: 100k req/day, 3 cron triggers |
| Hetzner Storage Box (backups, optional) | €3.40 | 1 TB — for VL/VM snapshot backups |
| **Total (minimum)** | **≈ €7/mo** | No backups |
| **Total (recommended)** | **≈ €10.40/mo** | With Storage Box backups |

Enterprise-dedicated tier (per client) upgrade to CCX13: +€9.50/mo per enterprise
client. Passed through to the client as part of their contract.

---

## 6. Client app contract

Every NextNode production app MUST expose the following for monitoring to work:

| Endpoint | Purpose | Failure mode |
|---|---|---|
| `GET /health` | Liveness — cheap, no downstream deps | `/health` down = process/network dead |
| `GET /ready` | Readiness — checks DB and external deps | `/ready` down but `/health` up = downstream issue |
| `GET /metrics` | Prometheus-format RED metrics (request counter, error counter, latency histogram) | No scrape data = monitoring blind to internals |

Plus:
- `@nextnode-solutions/logger` with `HttpTransport` pointing at the monitoring
  endpoint, bearer token from `process.env.NEXTNODE_MONITORING_TOKEN`
- `[monitoring]` blocks in the project's `nextnode.toml` declaring the SLO

**Enforcement** (Step 12): lint rule or CI gate in `@nextnode-solutions/standards`
that rejects NextNode projects missing these contracts.

---

## 7. Implementation phases

All steps are sequenced to produce a working end-to-end MVP as early as possible,
then layer advanced features. Each step has a clear definition of done — DO NOT
move to the next step until the current one passes format/lint/tests per the
global "Definition of Done" rule.

Tasks use `- [ ]` for progress tracking. Tick them off as you go.

---

### PHASE 1 — FOUNDATION

#### Step 1: Package scaffold `[DONE]`

**Goal**: create `packages/monitoring/` with the layered architecture skeleton,
wired into the pnpm workspace and turborepo, so `pnpm --filter @nextnode-solutions/monitoring build` passes on an empty package.

**Tasks**:
- [x] Read `packages/infrastructure/package.json`, `tsconfig.json`, `oxfmt.config.ts`,
      `CLAUDE.md` as the reference template
- [x] Create `packages/monitoring/package.json`:
  - Name: `@nextnode-solutions/monitoring`
  - Version: `0.0.0-development`
  - Private (no `publishConfig`)
  - `bin`: `{"nn-monitor": "./dist/index.js"}`
  - `scripts`: build (tsup), lint (oxlint), format (oxfmt), test (vitest), type-check (tsgo)
  - `dependencies`: `@nextnode-solutions/logger` (workspace), `smol-toml`, `hono` (later steps)
  - `devDependencies`: `@nextnode-solutions/standards` (workspace), `@types/node`, `@vitest/coverage-v8`, `oxfmt`, `oxlint`, `tsup`, `vitest`
- [x] Create `packages/monitoring/tsconfig.json` extending `@nextnode-solutions/standards`
- [x] Create `packages/monitoring/oxfmt.config.ts` re-exporting from standards
      (memory `project_oxfmt_extends_pr.md` supersedes the `.oxfmtrc.json` task —
      oxfmt >=0.43.0 supports `oxfmt.config.ts`, no JSON needed)
- [x] Create `packages/monitoring/oxlint.config.ts` extending standards oxlint
- [x] Create `packages/monitoring/vitest.config.ts` re-exporting standards/vitest/backend
- [x] Create `packages/monitoring/CLAUDE.md` — mirrors `packages/infrastructure/CLAUDE.md`
      with monitoring-specific layer table and secret handling notes
- [x] Create `packages/monitoring/nextnode.toml` + `.gitignore`
- [x] Create `packages/monitoring/src/index.ts` — 4 lines, argv dispatch to `runCommand`
- [x] Create `packages/monitoring/src/cli/commands.ts` — command registry (empty dispatcher)
- [x] Create `packages/monitoring/src/cli/env.ts` — typed env readers (`requireEnv`, `getEnv`)
- [x] `pnpm install` at root to link the new workspace (7 projects)
- [x] `pnpm --filter @nextnode-solutions/monitoring build` passes
- [x] `pnpm --filter @nextnode-solutions/monitoring lint` passes
- [x] `pnpm --filter @nextnode-solutions/monitoring format:check` passes
- [x] `pnpm --filter @nextnode-solutions/monitoring type-check` passes
- [x] `pnpm --filter @nextnode-solutions/monitoring test` passes (no tests yet, `--passWithNoTests`)

**Decisions taken during Step 1** (see Section 11 decision log for details):
- Dropped `--dts` from tsup build — private CLI bin, `exports.types` points at source,
  and tsup DTS via typescript@6.0.2 hits a pre-existing `baseUrl` deprecation error
  on main that also breaks `infrastructure:build`. DTS emission adds zero value for a
  bin package that is never published.
- Added explicit `"types": ["node"]` to `tsconfig.json` — tsgo did not auto-pick up
  `@types/node` in a fresh workspace package even with it in devDeps.
- `vitest.config.ts` uses `mergeConfig(baseConfig, defineConfig({ test: { passWithNoTests: true }}))`
  per the `nextnode-infra` compliance skill (re-export pattern is forbidden).
  The `passWithNoTests` override lives in config, not in the `test` script flags,
  and must be removed once real tests land in Step 3.

**Definition of done**: empty package builds, lints, formats, types, tests. No business logic yet. ✅

**Files created**: 12 files under `packages/monitoring/` (package.json, tsconfig.json,
oxfmt.config.ts, oxlint.config.ts, vitest.config.ts, CLAUDE.md, nextnode.toml,
.gitignore, src/index.ts, src/cli/commands.ts, src/cli/env.ts, + dist/ build output).

---

#### Step 2: `nextnode.toml` schema extension `[DONE]`

**Goal**: extend the shared `nextnode.toml` schema in `packages/infrastructure`
with `[monitoring]`, `[monitoring.slo]`, and `[monitoring.healthcheck]` blocks.
All optional so existing projects don't break.

**Tasks**:
- [x] Read `packages/infrastructure/src/config/` to understand the current schema, loader, and tests
- [x] Add `MonitoringConfig` type to `packages/infrastructure/src/config/schema.ts` matching Section 4
- [x] Add `MonitoringSloConfig` sub-type (availability, latency_ms_p95/p99, window_days)
- [x] Add `MonitoringHealthcheckConfig` sub-type (path, interval_seconds, timeout_ms, expected_status)
- [x] Add parser/validators for `[monitoring.*]` blocks (extracted per-field helpers to keep
      complexity below the oxlint cap of 15 and name every magic number)
- [x] Validation rules enforced:
  - `availability` must be in (0, 100]
  - `latency_ms_p95` must be > 0
  - `latency_ms_p99` must be > 0 AND ≥ `latency_ms_p95` if both set
  - `window_days` must be ≥ 1
  - `interval_seconds` must be ≥ 1 (default: 5)
  - `timeout_ms` must be > 0 (default: 2000)
  - `expected_status` must be an integer in [100, 599] (default: 200)
  - `endpoint` must parse as a valid `https://` URL
  - healthcheck `path` must be a non-empty string starting with `/`
- [x] 20 new unit tests in `schema.test.ts` (now 60 total):
      valid full / minimal / absent; each invalid case; boundary availability=100;
      non-table `[monitoring]` and `[monitoring.slo]`; malformed URL
- [x] New fixture `fixtures/with-monitoring.toml` + 2 load.test.ts cases
- [x] Expose infrastructure schema as a typed subpath export via
      `"./config/schema"` in `packages/infrastructure/package.json`'s `exports`
- [x] Add `@nextnode-solutions/infrastructure` as a workspace devDep of monitoring
      (types-only consumer)
- [x] Create `packages/monitoring/src/domain/slo.ts` (NOT `config/slo-schema.ts`
      — see deviation below) with pure computations:
      `computeBaselineErrorRatio`, `computeErrorBudgetMinutes`,
      `computeBurnRateThresholds`, `SRE_BURN_RATE_WINDOWS` constant
- [x] 16 unit tests in `domain/slo.test.ts` covering the SRE workbook math
- [x] All gates green on both packages: build, lint, format:check, type-check, test
- [x] Byproduct fix: `packages/infrastructure/src/adapters/plan-outputs.test.ts`
      fixtures were missing `deploy` (pre-existing main breakage) and `monitoring`;
      both added via a single replace-all.

**Decisions taken during Step 2** (appended to decision log):
- **slo.ts lives in `domain/`, not `config/`.** The plan suggested
  `packages/monitoring/src/config/slo-schema.ts`, but the package CLAUDE.md
  reserves `config/` for loaders and mandates pure business math in `domain/`.
  Domain wins: the module is pure, has no IO, and depends only on a type from
  infrastructure. This is a minor plan correction, not an architectural pivot.
- **Subpath type-only export from infrastructure.** `packages/infrastructure`
  now exposes `./config/schema` as a types-only entry so monitoring can
  `import type { MonitoringSloConfig } from '@nextnode-solutions/infrastructure/config/schema'`
  without pulling in the CLI runtime. Keeps the layer boundary intact.
- **Validator refactor for complexity.** Each field check is now a small pure
  helper returning `{ error, value }`. This keeps every function well under
  the oxlint complexity cap of 15 and makes per-field logic trivially testable
  if we ever need it.
- **`pnpm test` via turbo trips a sandbox write error** (`/tmp/<random>/ssr`
  from vitest's SSR transform cache). Per-package `pnpm --filter … test` runs
  fine under `$TMPDIR`. Not a code bug; flagged for CI vs local divergence.
  Worked around by running tests per-package during Step 2.

**Definition of done**: a `nextnode.toml` with a `[monitoring.slo]` block parses
cleanly; malformed ones produce specific validation errors; the monitoring
package imports the schema types as type-only and ships pure SRE-burn-rate
math tested with 16 unit cases. ✅

**Files created**: 4 new (
`packages/infrastructure/src/config/fixtures/with-monitoring.toml`,
`packages/monitoring/src/domain/slo.ts`,
`packages/monitoring/src/domain/slo.test.ts`,
the new test suite blocks inside `schema.test.ts` and `load.test.ts`
) + 5 edited (`schema.ts`, `schema.test.ts`, `load.test.ts`,
`plan-outputs.test.ts`, `infrastructure/package.json`,
`monitoring/package.json`, `monitoring/vitest.config.ts`).

---

### PHASE 2 — CORE SERVICES

#### Step 3: Auth & token management `[DONE]`

**Goal**: the foundation of multi-tenancy. Generate, store (hashed), verify, list,
revoke, and rotate per-project bearer tokens via a `nn-monitor token` CLI subcommand.

**Tasks**:
- [x] Create `packages/monitoring/src/domain/token.ts`:
  - `formatToken(randomBytes)` — pure, caller injects 32 random bytes (adapter/cli owns `crypto.randomBytes`). Deviates from the original `generateToken()` wording to satisfy the package's "domain is 100% pure" rule.
  - `hashToken(plaintext: string): string` — sha256 hex
  - `verifyToken(plaintext: string, hash: string): boolean` — `timingSafeEqual`, rejects wrong-length hashes
- [x] Create `packages/monitoring/src/domain/tenant.ts`:
  - `Tenant` type, `TenantTier` union, `rateLimitForTier`, `isTenantTier` guard
- [x] Create `packages/monitoring/src/adapters/token-store.ts`:
  - `node:sqlite` `DatabaseSync` (Node 24 stdlib) with WAL journal mode
  - CRUD: `create`, `findByHash`, `findById`, `list`, `revoke`, `rotate`
  - Schema migration on first run; `rotate` runs in a `BEGIN IMMEDIATE` transaction
  - Row parsing via an `isTenantRow` type guard — no `as` assertions
- [x] Create `packages/monitoring/src/cli/token.command.ts` with subcommands:
  - `create --client <id> --project <name> [--tier standard|enterprise]` — prints the plaintext ONCE in a JSON line
  - `list [--all]` — JSON lines, one per tenant; `--all` includes revoked
  - `revoke --id <id>` — marks `revoked_at`
  - `rotate --id <id>` — atomic: new row + revoke old, prints new plaintext
- [x] Register command in `cli/commands.ts`, propagate argv through `index.ts`
- [x] Pure unit tests on domain functions (28 tests on `tenant.ts` + `token.ts`)
- [x] Integration tests on `token-store` with temp SQLite dirs (17 tests)
- [x] In-process CLI tests with injected `dbPath` + `write` capture (18 tests)

**Definition of done**: `nn-monitor token create --client foo --project bar`
prints a token (as a JSON line on stdout), stores its hash in SQLite, `token
list` shows it, `token revoke` invalidates it. 79 monitoring tests pass
(domain + adapter + cli).

**Files created**: 8 files in `packages/monitoring/src/{domain,adapters,cli}`.

**Decisions taken during Step 3** (appended to decision log):

- **Domain token API: `formatToken(randomBytes)` instead of `generateToken()`.**
  The monitoring package's CLAUDE.md forbids `crypto.randomBytes` inside domain
  functions (domain must be deterministic on its inputs). The adapter/cli layer
  owns `randomBytes(32)` and passes the bytes in. Tests pass fixed bytes for
  fully deterministic assertions.
- **`node:sqlite` over `better-sqlite3`.** The plan preferred stdlib when
  available; Node 24.14 exposes `DatabaseSync` out of the box. Downside: emits
  an `ExperimentalWarning` at import time — accepted since the CLI is internal
  and the warning is harmless. No native-addon compile step.
- **`no-type-assertion` oxlint rule (repo-wide) forbids `as`.** Row parsing in
  the adapter and JSON parsing in the CLI tests both use explicit runtime type
  guards (`isTenantRow`, `isRecord`, `parseJsonLine`, `readString`). This
  surfaced late — each layer required a small refactor. Keep type guards as the
  default pattern from now on in this package.
- **CLI output format is JSON lines, not tables.** Machine-readable for the
  deploy pipeline and deterministic for tests. Tokens print on a single line
  in the `create`/`rotate` payload — operators copy-paste from stdout.
- **`process.stdout.write` instead of `console.log` in CLI output.** oxlint's
  `no-console` rule warns on `console.log`; `process.stdout.write` is the
  unambiguously correct low-level write for CLI user output.

---

#### Step 4: Hono ingest service (MVP) `[TODO]`

**Goal**: HTTP server accepting log batches from `@nextnode-solutions/logger` HTTP
transport, authenticating via tokens from Step 3, rate-limiting per tenant,
forwarding to VictoriaLogs.

**Tasks**:
- [ ] Add `hono` dependency to `packages/monitoring/package.json`
- [ ] Create `packages/monitoring/src/domain/log-envelope.ts`:
  - `LogEnvelope` type matching the payload from `packages/logger/src/transports/http.ts`
    (see its `send` method: `{ logs: LogEntry[] }`)
  - Pure validation function
- [ ] Create `packages/monitoring/src/domain/rate-limiter.ts`:
  - Pure sliding-window implementation: `checkLimit(state, now, limitRpm) → { allowed, newState }`
  - No IO, no setInterval — caller owns the clock
- [ ] Create `packages/monitoring/src/adapters/rate-limiter-store.ts`:
  - In-memory Map<client_id, RateLimitState>
  - Wraps the pure domain function, owns `Date.now()`
- [ ] Create `packages/monitoring/src/adapters/victorialogs-client.ts`:
  - `push(entries: EnrichedLogEntry[]): Promise<void>`
  - POSTs to `http://victorialogs:9428/insert/jsonline` with `Content-Type: application/stream+json`
  - Reads VL endpoint from env (`MONITORING_VL_URL`)
  - Retries with exponential backoff on 5xx (no silent swallow — all errors logged + re-thrown)
- [ ] Create `packages/monitoring/src/adapters/http-server.ts`:
  - Hono app setup
  - `POST /ingest/logs`:
    - Extract `Authorization: Bearer <token>` header
    - Look up tenant via `token-store` (hash + find)
    - On miss: 401 + structured log
    - Rate limit check per tenant
    - On exceeded: 429 + structured log
    - Parse + validate `LogEnvelope`
    - Enrich each entry with `client_id`, `project`, `environment` labels from tenant
    - Forward to VictoriaLogs client
    - Return 204 on success
  - `GET /healthz` — liveness (no deps)
  - `GET /readyz` — readiness (checks SQLite + VL reachable)
  - Request logging via `@nextnode-solutions/logger`
- [ ] Create `packages/monitoring/src/cli/serve.command.ts`:
  - Reads `MONITORING_HTTP_PORT`, `MONITORING_VL_URL`, `MONITORING_DB_PATH` from env via `cli/env.ts`
  - Starts Hono server with graceful shutdown
- [ ] Register command in `cli/commands.ts`
- [ ] Integration tests:
  - Valid token → 204, VL receives the enriched logs
  - Invalid token → 401
  - Missing Authorization → 401
  - Rate limit exceeded → 429
  - Malformed body → 400
  - VL unreachable → 503 (does NOT silently swallow)
- [ ] Manually smoke-test against a local `victoria-logs` binary in Docker

**Definition of done**: `nn-monitor serve` starts the ingest server; a curl with a
valid token against `/ingest/logs` lands rows in VictoriaLogs tagged with the
tenant's labels. Rate limiting works. All error paths log + propagate per the
strict error handling rules.

**Files created**: ~8 files. Depends on Step 3.

---

#### Step 5: Uptime probe worker `[TODO]`

**Goal**: a 5-second loop that probes every tenant's `[monitoring.healthcheck]`
target, detects state changes, writes metrics to VictoriaMetrics, and writes
state-change events to VictoriaLogs.

**Tasks**:
- [ ] Create `packages/monitoring/src/domain/uptime-check.ts`:
  - `performCheck(target: HealthcheckTarget, now: Date, fetchFn: FetchFn): Promise<HealthStatus>`
  - Pure: takes fetch as a dependency, returns a value
  - Records: status ('up'|'down'|'degraded'), latency_ms, http_status, error_reason
  - `fetchFn` is `typeof fetch`
- [ ] Create `packages/monitoring/src/domain/state-machine.ts`:
  - `detectStateChange(previous: HealthStatus, current: HealthStatus): StateChange | null`
  - Only emit events on actual transitions (not on every 5s tick)
  - Pure
- [ ] Create `packages/monitoring/src/adapters/target-registry.ts`:
  - Loads targets from the tenant DB, joined with the tenant's registered `[monitoring.healthcheck]` config
  - Needs a way for clients to publish their healthcheck config — for v1, store it in the SQLite `tenants` table at token-create time (update Step 3 to accept healthcheck overrides, OR read from `nextnode.toml` sent as part of the deploy pipeline)
  - **DECISION NEEDED** before implementation: push model (client pushes its healthcheck config to monitoring API) or pull model (monitoring pulls from client's GitHub raw `nextnode.toml`)? Flag to user during step.
- [ ] Create `packages/monitoring/src/adapters/probe-scheduler.ts`:
  - Per-target `setInterval(check, target.interval_seconds * 1000)`
  - Uses `unref()` so the process can exit cleanly
  - In-memory last-known state per target
  - On state change → calls metric writer AND log writer
- [ ] Create `packages/monitoring/src/adapters/victoriametrics-client.ts`:
  - `writeMetric(metric: Metric): Promise<void>`
  - Uses VM's `/api/v1/import/prometheus` text endpoint for simplicity
  - Reads VM endpoint from `MONITORING_VM_URL`
- [ ] Create `packages/monitoring/src/adapters/metric-writer.ts`:
  - Converts `HealthStatus` → `uptime_probe{client_id, project, status}` metric + `uptime_probe_latency_ms` histogram
  - Pushes via `victoriametrics-client`
- [ ] Create `packages/monitoring/src/cli/probe.command.ts`:
  - Starts the probe scheduler worker
  - Reads target list, subscribes to registry changes
- [ ] Unit tests on all domain functions (pure, no mocks)
- [ ] Integration tests with mocked fetch + real VM in Docker

**Definition of done**: `nn-monitor probe` spawns a worker that polls every
tenant's healthcheck every 5s; `uptime_probe{project="foo"}` shows up in
VictoriaMetrics; state-change events show up in VictoriaLogs.

**Files created**: ~9 files. Depends on Step 3 (tenants), Step 4 (VL adapter for
state-change logs — share the client).

---

### PHASE 3 — ALERTING

#### Step 6: SLO → vmalert rule generator `[TODO]`

**Goal**: auto-generate vmalert recording and alerting rules from each tenant's
`[monitoring.slo]` block, following the multi-window multi-burn-rate technique
from the Google SRE workbook.

**Tasks**:
- [ ] Create `packages/monitoring/src/domain/burn-rate.ts`:
  - `computeBurnRateThresholds(slo: SloConfig): BurnRateAlerts`
  - Returns: `{ page: { window1h, window6h, threshold1h, threshold6h }, ticket: { window3d, threshold3d } }`
  - Derivation per SRE workbook:
    - error budget = (100 - availability) / 100
    - page (fast burn): 2% of 30d budget burned in 1h (burn rate 14.4) AND 5% in 6h (burn rate 6)
    - ticket (slow burn): 10% burned in 3d (burn rate 1)
  - Pure function
- [ ] Create `packages/monitoring/src/domain/vmalert-rule.ts`:
  - Types for `RecordingRule` and `AlertingRule` matching vmalert's YAML shape
- [ ] Create `packages/monitoring/src/domain/slo-to-rules.ts`:
  - `generateRules(tenant: Tenant, slo: SloConfig): { recordingRules, alertingRules }`
  - Recording rules:
    - `job:slo_errors_per_request:ratio_rate1h{client_id, project}`
    - `...rate6h`, `...rate3d`
    - Based on RED metrics scraped from client app `/metrics`
  - Alerting rules (per SRE workbook, Section 2.9):
    - `SLOBurnRatePage`: fires when rate1h > 14.4 * budget AND rate6h > 6 * budget
    - `SLOBurnRateTicket`: fires when rate3d > 1 * budget
    - Each carries `client_id`, `project`, `severity`, `runbook_url` labels
- [ ] Create `packages/monitoring/src/adapters/vmalert-rules-writer.ts`:
  - Writes all tenants' rules to a YAML file on disk (grouped by tenant)
  - Sends SIGHUP to the vmalert process (or HTTP reload endpoint if available)
- [ ] Create `packages/monitoring/src/cli/generate-rules.command.ts`:
  - Reads all non-revoked tenants
  - Generates rules per tenant
  - Writes unified file
  - Reloads vmalert
- [ ] Unit tests on every domain function with SLO fixtures:
  - 99.9% availability produces exactly the thresholds from the SRE workbook
  - 99% availability produces appropriately lower thresholds
  - Multiple tenants produce independent rule groups
- [ ] Manually validate the generated YAML against a running vmalert instance

**Definition of done**: `nn-monitor generate-rules` emits a YAML file vmalert can
load without error; the rules correspond to what the SRE workbook prescribes for
the declared SLO.

**Files created**: ~6 files. Depends on Step 2 (schema) and Step 3 (tenants).

---

#### Step 7: Alert routing & notifications `[TODO]`

**Goal**: receive vmalert webhook fires, deduplicate, route to notification
channels (email/Slack/Discord), and record incidents with stable IDs for the
status page and SLA reports.

**Tasks**:
- [ ] Create `packages/monitoring/src/domain/alert.ts`:
  - `Alert` type (matches vmalert webhook payload)
  - `Severity = 'page' | 'ticket'`
- [ ] Create `packages/monitoring/src/domain/incident.ts`:
  - `Incident` type: `{ id, client_id, project, severity, opened_at, closed_at | null, alerts[], summary }`
  - `buildIncidentId(alert: Alert): string` — stable hash from alert name + labels (not timestamp)
- [ ] Create `packages/monitoring/src/domain/alert-router.ts`:
  - Pure routing rules: `(alert, tenant) → Channel[]`
  - Page → all channels; ticket → email + issue tracker only; maintenance window → suppressed
- [ ] Create `packages/monitoring/src/adapters/incident-store.ts`:
  - SQLite table: incidents + alert_events
  - CRUD: openIncident, closeIncident, appendEvent, listOpen, listByProject
- [ ] Create `packages/monitoring/src/adapters/notification-channels/`:
  - `email-smtp.ts` — uses `nodemailer` or native SMTP via env config
  - `discord-webhook.ts` — POSTs to Discord webhook URL
  - `slack-webhook.ts` — POSTs to Slack webhook URL
  - Each reads its config from env (never from the toml)
- [ ] Add `POST /webhook/vmalert` route to the Hono app from Step 4:
  - Parses vmalert payload
  - For each firing alert → open incident (or append to existing)
  - For each resolved alert → close incident
  - For each state change → route via `alert-router` and send notifications
  - Returns 204
- [ ] Maintenance window support:
  - SQLite table: `maintenance_windows { tenant_id, start, end, reason }`
  - Alert router checks window before routing
  - `nn-monitor maintenance start/end` CLI subcommands
- [ ] Unit tests on alert-router and incident domain (pure)
- [ ] Integration tests with sample vmalert payloads
- [ ] Dedup test: two fires of the same alert = one incident

**Definition of done**: a vmalert fire produces a notification on the configured
channel, creates an incident row, and a subsequent resolve closes it. Maintenance
windows correctly suppress notifications.

**Files created**: ~10 files. Depends on Steps 3 (tenants), 4 (Hono app), 6 (vmalert).

---

### PHASE 4 — DEPLOYMENT

#### Step 8: Docker Compose + Caddy + full infrastructure `[TODO]`

**Goal**: a single `docker-compose.yml` that brings up the entire monitoring stack
on the Hetzner CX33, with Caddy handling TLS and reverse proxy, and volume
persistence for logs/metrics/SQLite.

**Tasks**:
- [ ] Create `packages/monitoring/deploy/docker-compose.yml`:
  - Services: `victoriametrics`, `victorialogs`, `vmalert`, `grafana`, `monitoring-api`, `caddy`
  - Internal network (monitoring-api is the only public entrypoint)
  - Volume mounts: `./data/vm`, `./data/vl`, `./data/grafana`, `./data/api-sqlite`, `./data/caddy`
  - Healthchecks on each service
  - Restart policy: `unless-stopped`
- [ ] Create `packages/monitoring/deploy/Caddyfile`:
  - `monitoring.nextnode.fr` → `monitoring-api:3000`
  - `grafana.monitoring.nextnode.fr` → `grafana:3000` (basic auth)
  - Automatic TLS via Let's Encrypt
  - HTTP → HTTPS redirect
- [ ] Create `packages/monitoring/deploy/victoriametrics.yml`:
  - Scrape config: read tenant list from API endpoint on `monitoring-api`, target each tenant's `/metrics` endpoint
  - 15s scrape interval
  - Relabelling to add `client_id`, `project`, `environment` labels
- [ ] Create `packages/monitoring/deploy/victorialogs.yml`:
  - `-retentionPeriod=30d`
  - `-retention.maxDiskSpaceUsageBytes=50GiB`
- [ ] Create `packages/monitoring/deploy/vmalert.yml`:
  - `-rule=/etc/vmalert/rules.yml` (the file written by Step 6)
  - `-datasource.url=http://victoriametrics:8428`
  - `-notifier.url=http://monitoring-api:3000/webhook/vmalert`
- [ ] Create `packages/monitoring/deploy/grafana/provisioning/datasources/`:
  - `victoriametrics.yml` — Prometheus datasource pointing at `vmsingle`
  - `victorialogs.yml` — Grafana VL plugin datasource
- [ ] Create `packages/monitoring/deploy/grafana/provisioning/dashboards/`:
  - `overview.json` — NextNode command center: all projects uptime, SLO burn, p95 latency
  - `per-project.json` — drill-down by project (templated variable)
- [ ] Create `packages/monitoring/deploy/.env.example`:
  - `MONITORING_DOMAIN`
  - `GRAFANA_ADMIN_PASSWORD`
  - SMTP creds, Discord webhook URL, etc.
  - **Never commit the real `.env`** — add `deploy/.env` to `.gitignore`
- [ ] Create `packages/monitoring/deploy/README.md`:
  - Initial setup: SSH to VPS, clone repo, copy `.env.example`, run `docker compose up -d`
  - Backup instructions (rsync `./data/` to Hetzner Storage Box)
  - Upgrade procedure
- [ ] Document how this integrates with `@nextnode-solutions/infrastructure` deploy pipeline (if applicable)
- [ ] Smoke test the full stack locally via `docker compose up` before shipping to VPS

**Definition of done**: `docker compose up -d` on a fresh CX33 brings up the
full stack; TLS is issued; `https://monitoring.nextnode.fr/healthz`
returns 200; Grafana is accessible behind basic auth.

**Files created**: ~10 files under `packages/monitoring/deploy/`. Depends on all
previous steps.

---

#### Step 9: Cloudflare Worker — second probe + dead-man's switch `[TODO]`

**Goal**: a free-tier Cloudflare Worker that probes every tenant from CF's global
edge every minute, plus probes the monitoring VPS itself (dead-man's switch).
Posts failures back to the monitoring service; posts catastrophic failures
directly to a backup notification channel.

**Tasks**:
- [ ] Decide location: `packages/monitoring/worker/` subdirectory OR new
      `packages/monitoring-worker/` package. Recommendation: subdirectory with its
      own `wrangler.toml` to keep related code colocated.
- [ ] Create `packages/monitoring/worker/wrangler.toml`:
  - `name = "nextnode-monitoring-probe"`
  - `main = "src/index.ts"`
  - `compatibility_date = "2026-04-01"`
  - Cron trigger: `"* * * * *"` (every minute)
  - KV namespace binding for target list + last-state cache
- [ ] Create `packages/monitoring/worker/src/index.ts`:
  - `scheduled()` handler
  - Fetches target list from KV (updated by the monitoring API on tenant changes)
  - Fan-out probe to all targets + the monitoring VPS itself
  - On monitoring VPS failure → **backup notification channel directly from worker**
    (Discord webhook URL as env var in wrangler — the ONLY reliable path when the
    main monitoring service is the thing that's down)
  - On target failure → POST result to monitoring API `POST /webhook/external-probe`
- [ ] Create `packages/monitoring/worker/src/dead-mans-switch.ts`:
  - Tracks consecutive failures to the monitoring VPS in KV
  - After 3 consecutive failures (3 minutes) → direct Discord notification
  - Resets on recovery
- [ ] Create `packages/monitoring/worker/src/probe.ts`:
  - Single-target probe with timeout
  - Pure function
- [ ] Add `POST /webhook/external-probe` to Hono app:
  - Correlates worker probe results with internal probe results
  - Raises confidence on double-confirmed failures
  - Writes to `uptime_probe_external` metric in VM
- [ ] Add `GET /internal/targets` to Hono app:
  - Returns the target list for the worker to pull
  - Auth via a separate admin token
  - Worker updates its KV from this endpoint on every run (or cache + refresh hourly)
- [ ] Deploy via `wrangler deploy`
- [ ] Smoke test: kill the monitoring VPS → verify Discord notification arrives within 3 minutes

**Definition of done**: CF Worker runs on schedule, its probes are visible in VM
under `uptime_probe_external`, killing the monitoring VPS for 3+ minutes produces
a Discord notification from the worker.

**Files created**: ~6 files under `packages/monitoring/worker/`, ~2 routes added
to Hono. Depends on Step 4 (Hono app), Step 8 (deployed monitoring VPS).

---

### PHASE 5 — EXTENDED FEATURES

#### Step 10: Synthetic monitoring `[TODO]`

**Goal**: scripted user-journey tests (not just `/health`) running on a schedule,
asserting real business-critical flows (login, checkout, API round-trip).

**Tasks**:
- [ ] Add `[monitoring.synthetic]` block to `nextnode.toml` schema (Step 2 follow-up):
  ```toml
  [[monitoring.synthetic]]
  name = "login-flow"
  interval_seconds = 60
  steps = [
    { method = "POST", path = "/auth/login", body = { email = "test@...", password = "${SYNTHETIC_PASSWORD}" }, assert_status = 200 },
    { method = "GET",  path = "/api/user/me", use_cookies_from = 1, assert_status = 200, assert_latency_ms_max = 500 },
  ]
  ```
- [ ] Create `packages/monitoring/src/domain/synthetic-test.ts`:
  - Declarative test type
  - `runTest(test, fetchFn, secrets)` → `TestResult`
  - Pure (secrets injected as a parameter)
- [ ] Create `packages/monitoring/src/adapters/synthetic-runner.ts`:
  - Schedules tests per tenant
  - Reads secrets from env (not toml)
  - Writes results as metrics + state-change logs
- [ ] Add CLI subcommand `nn-monitor synthetic`
- [ ] Unit tests on the pure runner with mocked fetch
- [ ] Example test for a NextNode project to validate end-to-end

**Definition of done**: a synthetic test for a real NextNode project runs every
minute; failures trigger the same alert pipeline as uptime probes.

**Files created**: ~5 files. Depends on Step 2 (schema), Step 5 (probe infra to share).

---

#### Step 11: Public status page `[TODO]`

**Goal**: per-project public status page at `https://status.nextnode.solutions/:project`
showing current state, remaining error budget for the month, recent incidents,
and 90-day uptime history.

**Tasks**:
- [ ] Add `GET /status/:project` to Hono:
  - Returns JSON by default (for client-side rendering)
  - Returns HTML with `Accept: text/html`
  - Data source: incidents SQLite table + live query to VM for SLO state
- [ ] Create `packages/monitoring/src/domain/status-page.ts`:
  - `buildStatusPage(project, slo, incidents, currentMetrics) → StatusPageData`
  - Pure: takes data, returns view model
- [ ] Create simple HTML template (Hono JSX or plain template string)
- [ ] Show:
  - Current status (operational / degraded / major outage) — derived from SLO state, not just up/down
  - Error budget remaining for the current month (minutes + %)
  - Last 10 incidents with timestamps, duration, summary
  - 90-day uptime bar chart
- [ ] Unit tests on the status page domain
- [ ] Integration test: mock data → rendered output matches expected

**Definition of done**: `https://status.nextnode.solutions/foo-app` renders a
public status page; it updates in real-time as incidents open/close.

**Files created**: ~4 files. Depends on Step 7 (incident store), Step 6 (SLO rules).

---

#### Step 12: Client contract enforcement `[TODO]`

**Goal**: make the monitoring contract discoverable and enforceable across all
NextNode projects — `/health`, `/ready`, `/metrics` endpoints + logger HTTP
transport + `[monitoring]` block in `nextnode.toml`.

**Tasks**:
- [ ] Update `@nextnode-solutions/logger` documentation to describe the
      `NEXTNODE_MONITORING_TOKEN` env var pattern + example HTTP transport setup
- [ ] Update `@nextnode-solutions/standards` docs to list required endpoints
      for NextNode apps
- [ ] Optional: linting rule or CI gate in the infrastructure `prod-gate` command
      that checks a project has `[monitoring]` configured before allowing deploy
- [ ] Document the token generation workflow end-to-end in `docs/`:
  1. SSH to monitoring VPS
  2. Run `nn-monitor token create --client X --project Y`
  3. Copy token to GitHub repo secrets as `NEXTNODE_MONITORING_TOKEN`
  4. Ensure deploy workflow injects it as env var
  5. Restart app
- [ ] (Optional, stretch) Add a skill file for `@nextnode-solutions/monitoring`
      following the pattern of `nextnode-logger`, `nextnode-standards`, etc.

**Definition of done**: a new NextNode project can be onboarded to monitoring in
under 10 minutes following the documented steps.

**Files touched**: docs only, possibly one CI gate extension. Depends on everything.

---

## 8. Out of scope (explicitly NOT in v1)

Listed here so we don't re-open these questions. Each can become a future phase.

- **Distributed tracing (OpenTelemetry traces)** — logs + metrics cover 90% of
  real incidents. Traces add complexity (OTel collector, Jaeger/Tempo) and value
  mainly for microservices, which NextNode projects are not.
- **Long-term log archive beyond 30 days** — if a client needs 1-year retention,
  that's an enterprise tier feature; add a cheap S3-compatible archive later
  (Backblaze B2, Hetzner Storage Box, or Cloudflare R2).
- **Self-service client onboarding portal** — a web UI for clients to view their
  own logs, manage their own synthetic tests, etc. v1 is admin-operated only.
- **Per-client Grafana orgs** — Grafana multi-tenancy via orgs works, but v1 is
  internal only. Add when a client asks for direct Grafana access.
- **ML anomaly detection** — too early, too noisy. Start with static thresholds
  from SLO, revisit after 6 months of baseline data.
- **Auto-remediation / runbook automation** — pager humans, don't build a robot
  that restarts services on its own.
- **Multi-region deployment of the monitoring VPS itself** — Cloudflare Worker
  handles the "second location" need; actually replicating the monitoring stack
  across regions is overkill for our scale.
- **Mobile app for on-call** — use existing tools (Discord mobile, PagerDuty if
  that's ever budgeted).
- **Cost attribution per tenant** — track later via tag-based metrics on
  ingestion volume + query load, but only when billing requires it.

---

## 9. Cross-cutting concerns

### 9.1 Error handling — strict per global CLAUDE.md

- No silent swallows anywhere
- Every `catch` logs + re-throws OR logs + returns an explicit error response
- No technical fallbacks without a business rule
- At the ingest endpoint: a failed VL push is a 503 to the client, not a 204
  with logs dropped

### 9.2 Testing strategy

- **Domain**: pure unit tests with value fixtures. If you need a mock to test a
  domain function, the logic is in the wrong layer — move it to an adapter.
- **Adapters**: integration tests with real temp files / real Docker services
  (use Testcontainers or docker-compose for Vitest integration runs).
- **CLI commands**: end-to-end of one command with env vars + stubbed fetch.
- **Config**: unit tests with TOML fixtures in `src/config/fixtures/`.
- Use vitest via `@nextnode-solutions/standards/vitest/backend`.
- Coverage target: 90%+ on domain layer, 70%+ on adapters, 50%+ on CLI.

### 9.3 Observability of the monitoring service itself (meta-monitoring)

The monitoring service must monitor itself:
- Instrumented with `@nextnode-solutions/logger` (structured JSON logs)
- Exposes its own `/metrics` endpoint — scraped by the same VictoriaMetrics that
  scrapes client apps. Meta!
- Its own SLO declared in a `[monitoring.slo]` block. Recursion works.
- Its own synthetic tests (hit its own `/healthz` from the CF Worker).
- The dead-man's switch in Step 9 is the last line of defense.

### 9.4 Secrets management

| Secret | Location | Rotation |
|---|---|---|
| Tenant bearer tokens | GitHub repo secrets (per client repo) + hashed in monitoring SQLite | `nn-monitor token rotate --id X` |
| Grafana admin password | `.env` on monitoring VPS only (never in git) | Manual |
| SMTP credentials | `.env` on monitoring VPS | Manual |
| Discord/Slack webhook URLs | `.env` on monitoring VPS | Regenerate in respective apps |
| Cloudflare Worker backup Discord URL | `wrangler secret put` | `wrangler secret` update |
| Synthetic test credentials | `.env` on monitoring VPS, per-tenant namespace | Manual |

### 9.5 Backup strategy

- Hetzner Storage Box (1 TB, €3.40/mo) recommended
- Nightly `rsync` of `/opt/monitoring/data/` (VM snapshots, VL data, SQLite)
- Weekly snapshot of the SQLite DB via `.backup` command (online backup)
- Test restores quarterly (add to a checklist in `deploy/README.md`)

---

## 10. Glossary

| Term | Definition |
|---|---|
| **SLI** | Service Level Indicator. A measurement of service behavior (e.g. "fraction of HTTP requests returning 2xx/3xx"). |
| **SLO** | Service Level Objective. A target for an SLI (e.g. "99.9% of requests succeed over 30 days"). |
| **Error budget** | `1 - SLO`. For 99.9% over 30 days, the budget is ~43 minutes/month of allowed "bad" time. |
| **Burn rate** | How fast, relative to the SLO, the service consumes the error budget. A burn rate of 1 means the error budget lasts exactly until the end of the window. |
| **Multi-window multi-burn-rate** | The Google SRE alerting technique: fire an alert only when burn rate exceeds threshold T in BOTH a short window and a longer window — kills flaps. |
| **Golden signals** | Latency, Traffic, Errors, Saturation. From the Google SRE book *Monitoring Distributed Systems*. |
| **RED method** | Rate, Errors, Duration. Brendan Gregg's method for request-driven services. A subset of golden signals. |
| **USE method** | Utilization, Saturation, Errors. For resources (CPU, RAM, disk). |
| **Black-box monitoring** | External probe — simulates a user. "Does it work right now?" |
| **White-box monitoring** | Internal metrics — what's happening inside the system. Catches imminent failures. |
| **Recording rule** | A precomputed PromQL/MetricsQL expression evaluated periodically and stored as a new metric — used to speed up complex queries. |
| **Alerting rule** | A PromQL/MetricsQL expression that, when true for a `for:` duration, fires an alert. |
| **Dead-man's switch** | An external heartbeat that alerts when the monitoring system itself stops responding. Catches silent monitor crashes. |
| **Multi-tenancy** | One physical instance serving multiple isolated tenants (clients/projects), with data separation via labels + auth. |
| **Runbook** | Documented response procedure for a specific alert. Every alert should have one. |

---

## 11. Decision log

Decisions recorded here so future sessions don't re-litigate them. Add new entries
as the project evolves.

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-10 | Single shared monitoring VPS (not per-project) | 10× cost saving at scale; command-center UX; matches industry standard |
| 2026-04-10 | Hetzner CX33 (not CAX21, not CCX13 default) | Cheapest adequate option at current pricing (€6.49 vs €7.99 vs €15.99); x86 avoids ARM friction |
| 2026-04-10 | VictoriaMetrics family over Prometheus + Alertmanager | Single vendor, lighter footprint, same query language, simpler single-node deployment |
| 2026-04-10 | VictoriaLogs over Grafana Loki | Simpler `/insert/jsonline` endpoint, no schema_config, no object storage required |
| 2026-04-10 | Custom 5s uptime worker over Uptime Kuma | Uptime Kuma minimum interval is 20s; Socket.IO-first API doesn't fit our pattern |
| 2026-04-10 | vmalert webhook → Hono routing over Alertmanager | Avoid yet another YAML DSL; keep routing logic in TypeScript we control |
| 2026-04-10 | Tokens NEVER in `nextnode.toml`, GitHub secrets + env vars only | Security: config is committed, secrets must not be |
| 2026-04-10 | Multi-window multi-burn-rate SLO alerts per Google SRE workbook | Canonical method; symptom-based; mathematically derived; client-sellable |
| 2026-04-10 | Cloudflare Worker as second probe + dead-man's switch (free tier) | Zero-cost solution to single-probe blind spot; the ONLY reliable path to catch a dead monitoring VPS |
| 2026-04-10 | Strict layered architecture mirroring `packages/infrastructure` | Consistency with existing NextNode patterns; proven to produce testable code |
| 2026-04-10 | `packages/monitoring/` location (not `apps/`, not separate repo) | Consistency with `packages/infrastructure` precedent; workspace consumption of logger and config |
| 2026-04-10 | NEVER published to npm | Private monorepo-consumed CLI + deployable, same pattern as `infrastructure` |
| 2026-04-11 | Domain `formatToken(randomBytes)` instead of `generateToken()` | CLAUDE.md forbids `crypto.randomBytes` inside domain functions; adapter/cli layer owns randomness so domain stays deterministic |
| 2026-04-11 | `node:sqlite` DatabaseSync over better-sqlite3 | Stdlib preference (Node 24.14 exposes it); zero dependency; no native compile step. Trade-off: emits harmless ExperimentalWarning at import |
| 2026-04-11 | CLI output is JSON lines on stdout, not tables | Machine-readable for deploy pipeline + deterministic for tests; operators copy-paste token from the `create`/`rotate` payload |
| 2026-04-11 | `process.stdout.write` over `console.log` in CLI output | oxlint `no-console` rule warns on console.log; stdout.write is the unambiguously correct low-level write for CLI user output |
| 2026-04-11 | Row parsing via `isTenantRow` type guard, not `as` assertions | Repo-wide `nextnode/no-type-assertion` oxlint rule forbids `as` (except `as const`); runtime type guards are the mandated pattern |

---

## 12. References

- Google SRE Book, *Monitoring Distributed Systems*: https://sre.google/sre-book/monitoring-distributed-systems
- Google SRE Workbook, *Alerting on SLOs*: https://sre.google/workbook/alerting-on-slos
- VictoriaMetrics docs: https://docs.victoriametrics.com/
- VictoriaLogs docs: https://docs.victoriametrics.com/VictoriaLogs/
- vmalert docs: https://docs.victoriametrics.com/vmalert/
- Hetzner Cloud pricing (verified 2026-04-10 from user-provided screenshots)
- Existing architecture reference: `packages/infrastructure/CLAUDE.md`
- Logger HTTP transport: `packages/logger/src/transports/http.ts`

---

**End of plan.** To resume work in a new session: read this entire file, check
the status tracker at the top, pick up from the next unfinished step. Every
architectural decision is locked in Section 2 — do not re-open them without
explicit user direction.
