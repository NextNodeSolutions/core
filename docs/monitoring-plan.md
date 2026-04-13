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

| Phase                           | Scope                                                      | Status          |
| ------------------------------- | ---------------------------------------------------------- | --------------- |
| **Phase 1 — Foundation**        | Package scaffold + `nextnode.toml` schema                  | `[DONE]`        |
| **Phase 2 — Core services**     | Logs pipeline (Vector + VL), uptime probes                 | `[IN PROGRESS]` |
| **Phase 3 — Alerting**          | SLO rule generator, alert routing                          | `[TODO]`        |
| **Phase 4 — Deployment**        | Docker Compose + Cloudflare Worker second probe            | `[TODO]`        |
| **Phase 5 — Extended features** | Custom dashboard (Astro), synthetic tests, client contract | `[TODO]`        |

**Current step**: Phase 2 / Step 3 — Logs pipeline (Vector + VictoriaLogs)
**Last updated**: 2026-04-12

> **Note (2026-04-11)** — This plan pivoted from a push-based Hono ingest
> service to a pull-based agent deployment (Vector on every VPS → VictoriaLogs
> direct over Tailscale). Steps 3 and 4 of the original plan (auth/token store
> and Hono ingest) were implemented, tested, and then deleted in favor of the
> simpler agent model. See the Decision log entry dated 2026-04-11 titled
> "Option A pivot: Vector + private network over Hono ingest API" for the
> full rationale. Git history on branch `feat/monitoring-package` preserves
> the removed code (commits `e990e4c`, `28eb766`, `b298a14`, `667d720`).

---

## 1. What we're building

A self-hosted multi-tenant monitoring service that:

1. Collects logs from every NextNode production project via a **Vector agent**
   running on each client VPS (tailing `docker logs` + journald), shipping
   NDJSON over a private network (Tailscale/WireGuard) directly into
   VictoriaLogs with 30-day retention
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

| Spec     | Value                                 |
| -------- | ------------------------------------- |
| vCPU     | 4 (Intel/AMD shared)                  |
| RAM      | 8 GB                                  |
| Disk     | 80 GB NVMe                            |
| Traffic  | 20 TB/month included                  |
| Location | EU (Nuremberg/Falkenstein)            |
| Price    | €6.49/mo + ~€0.50/mo IPv4 ≈ **€7/mo** |

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

| Component                                              | Role                                                                                | Why this, not alternatives                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VictoriaMetrics** (`vmsingle`)                       | Scrape `/metrics`, store time series, evaluate MetricsQL                            | Drop-in Prometheus replacement, PromQL-compatible, single Go binary, ~50–150 MB RAM idle. Way lighter than Prometheus.                                                                                  |
| **VictoriaLogs**                                       | Store logs, 30-day retention (`-retentionPeriod=30d`)                               | Single Go binary, native NDJSON ingest at `/insert/jsonline`, no schema_config, no object storage. Much simpler than Loki for a single-node deploy.                                                     |
| **Vector** (per client VPS)                            | Tail `docker logs` + journald + files, batch, compress, ship NDJSON to VictoriaLogs | ~30 MB Rust binary, single TOML config, native VL sink, disk-backed buffer, automatic retries. Decouples every client app from observability — apps just log to stdout.                                 |
| **Tailscale / WireGuard**                              | Private mesh between each client VPS and the monitoring VPS                         | Zero-trust network identity per host; VictoriaLogs stays OFF the public internet. The network is the trust boundary — no application-level auth tokens needed.                                          |
| **vmalert**                                            | Evaluate recording + alerting rules against VM and VL, fire webhooks                | Replaces Prometheus rule evaluator AND Alertmanager's rule half. Ships webhook notifier — no Alertmanager config DSL needed.                                                                            |
| **Grafana**                                            | Dashboards, ad-hoc query explorer for VM and VL                                     | Industry standard, first-class datasources for both VM and VL. Worth the ~200 MB RAM to avoid building dashboards ourselves.                                                                            |
| **`@nextnode-solutions/monitoring`** (slim TS service) | 5s probe worker, vmalert rule generator, vmalert webhook receiver, status page      | The TypeScript service that makes this ours. Handles probe scheduling, SLO→rules compilation, alert routing, incident tracking. Deliberately does NOT handle log ingest — Vector + VL do that directly. |

**Killed from the design**:

- ❌ Prometheus — replaced by VictoriaMetrics
- ❌ Alertmanager — replaced by vmalert webhook → Hono routing
- ❌ Loki — rejected in favor of VictoriaLogs (simpler storage, better single-node story)
- ❌ `blackbox_exporter` — our own 5s worker covers it with better tenant awareness
- ❌ Uptime Kuma — 20s minimum interval, Socket.IO-first API, doesn't fit
- ❌ **Hono-based ingest API with bearer tokens** — built and tested, then deleted (2026-04-11). With NextNode owning all client VPSs, the Tailscale private network is the trust boundary and an application-auth layer is pure ceremony. If a future SaaS tier arrives, the ingest API can be reintroduced as a separate package informed by real customer requirements. |

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

### 2.7 Multi-tenancy: labels + private-network identity

**Decision**: every log, metric, and alert carries `client_id`, `project`,
`environment` labels. Tenant identity is established by the private-network
address of the source host (Tailscale node identity), not by an application
auth token.

- Labels on logs are **injected by Vector** on each client VPS via the
  `transforms.add_fields` section of its `vector.toml`. Each VPS is a known
  Tailscale node, so the `client_id`/`project` it writes under is a fact of
  deployment, not a claim a runtime process makes.
- Every metric scraped by VictoriaMetrics is relabelled with the same set from
  scrape config
- Alerts are labelled from vmalert rules generated per tenant
- Grafana orgs/folders can be used later to give clients read-only self-service
  access to their own data (NOT in v1)

If a client VPS is compromised, the attacker can write logs under that
tenant's labels — same blast radius as the old bearer-token model, without
the extra moving part. Mitigation at the Tailscale layer (ACLs) is the
defense-in-depth path if it's ever needed.

### 2.8 Secrets: minimized — no application auth for logs

**Decision**: the logs pipeline has no application-level secret. Tenant
identity is asserted by the private-network membership of each host. Secrets
in the system are reduced to infrastructure credentials (Tailscale auth keys,
Grafana admin password, webhook URLs).

**Flow (logs)**:

1. Admin provisions a new client VPS and joins it to the Tailscale tailnet
2. `nextnode-deploy` drops a `vector.toml` on the VPS with the `client_id`,
   `project`, `environment` fields hard-coded in `transforms.add_fields`
3. Vector starts on boot as a systemd unit (or a sidecar container), tails
   `docker logs` + journald, ships NDJSON to `http://monitoring.ts.net:9428/insert/jsonline`
4. VictoriaLogs listens only on the Tailscale interface — not the public internet

**Flow (operator secrets)**:

| Secret                               | Location                                       | Rotation                      |
| ------------------------------------ | ---------------------------------------------- | ----------------------------- |
| Tailscale auth key (per host)        | `tailscale up --authkey=...` at provision time | Reauth via `nextnode-deploy`  |
| Grafana admin password               | `.env` on monitoring VPS                       | Manual                        |
| SMTP credentials                     | `.env` on monitoring VPS                       | Manual                        |
| Discord/Slack webhook URLs           | `.env` on monitoring VPS                       | Regenerate in respective apps |
| Cloudflare Worker backup Discord URL | `wrangler secret put`                          | `wrangler secret` update      |

**Security properties**:

- Zero application-level tokens to rotate for logs
- VictoriaLogs is completely unreachable without tailnet membership — a leaked
  secret anywhere else cannot be used to write spam logs
- Tenant spoofing requires either compromising a client VPS (same blast
  radius as the old bearer-token model) or getting onto the tailnet with
  forged identity (defeated by Tailscale ACLs)
- Onboarding a new tenant is "provision + join tailnet" — no token-create
  dance, no GitHub secret, no redeploy

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
`/metrics` scrape) per the SRE book's _Monitoring Distributed Systems_ chapter.

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
                        ── Tailscale private mesh (no public ingress for logs) ──

┌──────── Client VPS A ────────┐         ┌──────── Client VPS B ────────┐
│ ┌──────────┐  docker logs    │         │ ┌──────────┐  docker logs    │
│ │ app1     │────────────────┐│         │ │ app3     │────────────────┐│
│ │ app2     │                ▼│         │ │ app4     │                ▼│
│ └──────────┘      ┌──────────┐│         │ └──────────┘      ┌──────────┐│
│                   │  Vector  ││         │                   │  Vector  ││
│                   │  + TOML  ││         │                   │  + TOML  ││
│                   └─────┬────┘│         │                   └─────┬────┘│
└─────────────────────────┼─────┘         └─────────────────────────┼─────┘
                          │ NDJSON over Tailscale                   │
                          │ (client_id/project injected here)       │
                          ▼                                         ▼
┌──────────────── Hetzner CX33 (monitoring VPS, Nuremberg) ────────────────┐
│  docker-compose.yml — managed via packages/monitoring/deploy/            │
│                                                                           │
│  ┌───────────────┐                        ┌──────────────────────┐       │
│  │ VictoriaLogs  │◄── direct write ───────┤ Vector (from every   │       │
│  │  :9428        │    (tailnet only)      │  client VPS)         │       │
│  └──────┬────────┘                        └──────────────────────┘       │
│         │                                                                 │
│         │ query                       ┌──────────────────────┐           │
│         ▼                             │ Client app VPSes     │           │
│  ┌───────────────┐ scrape /metrics    │ (multiple projects)  │           │
│  │VictoriaMetrics│◄───── every 15s ───┤  on Tailscale        │           │
│  │  :8428        │                    └──────────┬───────────┘           │
│  └──────┬────────┘                               │ 5s HTTP probe         │
│         │                                        │                       │
│         │ query                      ┌───────────▼──────────┐            │
│         ▼                            │ monitoring TS svc    │            │
│  ┌───────────────┐                   │  :3000 — Caddy TLS   │            │
│  │ vmalert       │ webhook on fire ─►│                      │            │
│  │  :8880        │                   │ - 5s probe worker    │            │
│  └───────────────┘                   │ - vmalert rule gen   │            │
│                                      │ - POST /webhook/vmalert│          │
│  ┌───────────────┐                   │ - GET  /status/:p    │            │
│  │ Grafana       │                   │ - SQLite: incidents  │            │
│  │  :3001        │                   └──────────┬───────────┘            │
│  └───────────────┘                              ▲                        │
│                                                 │ heartbeat              │
│                                      ┌──────────┴──────────┐             │
│                                      │ Cloudflare Worker   │ FREE        │
│                                      │ (2nd probe + DMS)   │             │
│                                      │ - cron trigger 1min │             │
│                                      │ - probes all targets│             │
│                                      │ - probes monitoring │             │
│                                      │   VPS itself (DMS)  │             │
│                                      └─────────────────────┘             │
└───────────────────────────────────────────────────────────────────────────┘
           ▲                                        ▲
           │ HTTPS (Caddy auto-TLS)                  │ cron wake
           │                                        │
      Operator → Grafana, public status pages        Cloudflare edge
```

---

## 4. `nextnode.toml` schema — the contract

Every NextNode project adds these blocks to its `nextnode.toml` to opt into
monitoring. All fields have sensible defaults; declaring the blocks is what
enables monitoring for that project.

```toml
[monitoring]
# Optional: client and project identifiers used as labels on everything
# (logs, metrics, alerts). Defaults derive from the project name, but
# declaring them explicitly is recommended.
client_id = "acme"
project   = "acme-web"

# The `endpoint` field is LEGACY (pre-Option-A pivot). With Vector + Tailscale,
# clients do not need to know the monitoring VPS address — Vector ships to VL
# directly via tailnet DNS. The field remains in the schema for now for
# backwards compat, but is unused by the pipeline.

[monitoring.slo]
# The promise to the client. Drives auto-generated vmalert rules.
availability   = 99.9   # % of requests that must succeed (2xx/3xx)
latency_ms_p95 = 500    # p95 latency ceiling (successful requests only)
latency_ms_p99 = 1500   # p99 latency ceiling (optional)
window_days    = 30     # rolling measurement window

[monitoring.healthcheck]
# The 5s black-box probe target on this app. The probe worker fetches this
# block from the project's nextnode.toml (GitHub raw) on a refresh loop.
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

| Item                                    | Monthly         | Notes                                       |
| --------------------------------------- | --------------- | ------------------------------------------- |
| Hetzner CX33 (monitoring VPS, EU)       | €6.49           | 4 vCPU, 8 GB RAM, 80 GB NVMe, 20 TB traffic |
| Primary IPv4                            | ~€0.50          | Standard Hetzner surcharge                  |
| Cloudflare Worker (second probe + DMS)  | €0              | Free tier: 100k req/day, 3 cron triggers    |
| Hetzner Storage Box (backups, optional) | €3.40           | 1 TB — for VL/VM snapshot backups           |
| **Total (minimum)**                     | **≈ €7/mo**     | No backups                                  |
| **Total (recommended)**                 | **≈ €10.40/mo** | With Storage Box backups                    |

Enterprise-dedicated tier (per client) upgrade to CCX13: +€9.50/mo per enterprise
client. Passed through to the client as part of their contract.

---

## 6. Client app contract

Every NextNode production app MUST expose the following for monitoring to work:

| Endpoint       | Purpose                                                                           | Failure mode                                      |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /health`  | Liveness — cheap, no downstream deps                                              | `/health` down = process/network dead             |
| `GET /ready`   | Readiness — checks DB and external deps                                           | `/ready` down but `/health` up = downstream issue |
| `GET /metrics` | Prometheus-format RED metrics (request counter, error counter, latency histogram) | No scrape data = monitoring blind to internals    |

Plus, at the **host** level (NOT the application level):

- **Vector** running as a systemd service or sidecar container on the VPS,
  configured via a `vector.toml` that tails the app's `docker logs` (or
  stdout/journald when running outside Docker) and ships NDJSON to
  `http://<monitoring-host>.ts.net:9428/insert/jsonline` over Tailscale
- **Tailscale** client joined to the NextNode tailnet, advertising the host
  identity used for label injection
- `[monitoring]` blocks in the project's `nextnode.toml` declaring the SLO
  and healthcheck target so the probe worker and rule generator can pick
  them up from GitHub raw

The app code itself **does not** import a monitoring SDK, does not read a
`NEXTNODE_MONITORING_TOKEN` env var, and does not make any HTTP call to the
monitoring service for logs. It simply writes structured logs to stdout and
Vector handles the rest.

**Enforcement** (Step 11): lint rule or CI gate in `@nextnode-solutions/standards`
that rejects NextNode projects missing the `/health`, `/ready`, `/metrics`
endpoints and the `[monitoring.slo]` / `[monitoring.healthcheck]` blocks.

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

#### Step 3: Logs pipeline — Vector + VictoriaLogs over Tailscale `[IN PROGRESS]`

**Goal**: ship logs from every client VPS into a single VictoriaLogs instance
on the monitoring VPS with zero application-level auth and zero custom
ingest code. This step is the replacement for the original Step 3 (token
store) + Step 4 (Hono ingest) after the 2026-04-11 Option A pivot — see
Decision log for the full rationale.

**Tasks**:

**3a. Tailscale mesh**

- [ ] Verify the monitoring VPS is joined to the NextNode tailnet and has a
      stable MagicDNS hostname (e.g. `monitoring.<tailnet>.ts.net`)
- [ ] Document the Tailscale auth-key provisioning flow for new client VPSes
      (reusable ephemeral key vs per-host key — trade-off noted in deploy docs)
- [ ] Add a Tailscale ACL that restricts `:9428` (VL ingest) to known client
      tags only, so a compromised non-monitoring node can't spam VL

**3b. VictoriaLogs container**

- [x] Add `victorialogs` service to `packages/monitoring/deploy/docker-compose.yml`
      (initial draft; Step 7 will merge the rest of the stack). Key flags:
    - `-retentionPeriod=30d`
    - `-retention.maxDiskSpaceUsageBytes=50GiB`
    - Listen only on the Tailscale interface (host port bound to `${TAILNET_BIND_ADDR}`)
- [x] Persistent volume mount `./data/vl` for log storage
- [x] Healthcheck in compose pointing at `/health` of VL
- [ ] Validated on an actual VPS (blocked on 3a)

**3c. Vector template for client VPSes**

- [x] Create `packages/monitoring/deploy/vector/vector.toml.template`:
    - `sources.docker_logs` — tails all docker containers on the host
    - `sources.journald` — tails host journald for non-container services
    - `transforms.add_tenant_fields` — injects `client_id`, `project`,
      `environment` from env vars set by `nextnode-deploy`
    - `sinks.victorialogs` — HTTP sink to `${NN_VL_URL}/insert/jsonline` with
      `encoding.codec = "json"`, `framing.method = "newline_delimited"` and
      `Content-Type: application/stream+json` header
    - Disk-backed buffer (`256 MB`, `when_full = "block"`) so a VL outage does
      not OOM the host
- [x] Document Docker alternative: Vector as a sidecar container in
      `packages/monitoring/deploy/vector/vector-sidecar.compose.yml`,
      mounting the Docker socket + journal read-only
- [x] **Decision: sidecar-by-default.** NextNode's client VPSes already run
      Docker Compose, so the sidecar path is the canonical one. The systemd
      unit file is deferred until a non-Docker customer actually asks for it
      — YAGNI.

**3d. `nextnode-deploy` integration**

- [ ] Extend `packages/infrastructure` deploy pipeline so that provisioning a
      new client VPS:
    1. Joins Tailscale using a pre-authorized ephemeral key
    2. Drops the rendered `vector.toml` with tenant fields filled in from
       the project's `nextnode.toml`
    3. Starts Vector (systemd or sidecar) and waits for the first successful
       NDJSON push
- [ ] Handle upgrades: `nextnode-deploy` re-renders `vector.toml` whenever
      `[monitoring]` fields change in a project's `nextnode.toml`

**3e. End-to-end validation**

- [ ] Stand up a staging monitoring VPS with VL + Tailscale
- [ ] Provision a throwaway client VPS with Vector, generate synthetic log
      traffic
- [ ] Confirm logs land in VL queryable by `client_id`, `project`,
      `environment` labels
- [ ] Kill VL, verify Vector's disk buffer accumulates, bring VL back,
      verify buffer drains without loss (this is the key property that
      motivates the agent pattern over direct app push)
- [x] Document the runbook for "Vector on VPS X is lagging" in
      `packages/monitoring/deploy/runbooks/vector-lag.md`

**What this step explicitly does NOT build**:

- A `nn-monitor serve` / `nn-monitor token` CLI — these existed in the old
  Steps 3 & 4, have been deleted, and are not coming back. Log ingest is
  Vector's job.
- Any adapter code in `packages/monitoring/src/`. This entire step is
  infrastructure config (compose file, vector.toml, systemd unit, docs)
  plus a `nextnode-deploy` extension. The TypeScript package stays
  dormant until Step 4 (Probe worker).

**Definition of done**: a fresh client VPS provisioned through
`nextnode-deploy` automatically ships its container logs to the shared
VictoriaLogs over Tailscale, with correct `client_id`/`project` labels,
and survives a monitoring VPS restart without log loss.

**Files created / touched**:

- `packages/monitoring/deploy/vector/vector.toml.template` (new)
- `packages/monitoring/deploy/vector/vector-sidecar.compose.yml` (new,
  optional sidecar pattern)
- `packages/monitoring/deploy/docker-compose.yml` (merged with Step 7)
- `packages/monitoring/deploy/runbooks/vector-lag.md` (new)
- `packages/infrastructure/src/...` — pipeline extension (scope TBD)

**Depends on**: Step 2 (schema — `[monitoring]` block is the source of
tenant labels).

**Informs**: Step 4 (probe worker reads the same `nextnode.toml` blocks),
Step 7 (full compose stack includes the VL service defined here).

---

#### Step 4: Uptime probe worker `[TODO]`

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
    - **Pull model** (decision resolved 2026-04-11): source of truth is each
      project's `nextnode.toml` in its GitHub repo. The adapter fetches the raw
      file for every registered project on a refresh loop (default: every 5 min)
      and exposes the parsed `[monitoring.healthcheck]` blocks as a target list.
    - The list of repos to watch lives in a static
      `packages/monitoring/deploy/tenants.toml` file on the monitoring VPS
      (checked into the monitoring repo, reviewed via PR). Adding a tenant =
      appending one entry and redeploying. No API, no SQLite, no token.
    - Uses `smol-toml` to parse the pulled `nextnode.toml` and reuses the
      infrastructure schema types via type-only import.
- [ ] Create `packages/monitoring/src/adapters/nextnode-toml-fetcher.ts`:
    - `fetchNextnodeToml(repoRef: RepoRef): Promise<string>` — GET over
      `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/nextnode.toml`
    - Handles 404 (repo removed / renamed) with an explicit logged error
    - Handles 200 with a TOML body that fails schema validation — logs and
      drops the target for this refresh cycle, keeps the last good copy
- [ ] Create `packages/monitoring/src/adapters/probe-scheduler.ts`:
    - Per-target `setInterval(check, target.interval_seconds * 1000)`
    - Uses `unref()` so the process can exit cleanly
    - In-memory last-known state per target
    - On state change → calls metric writer AND log writer
    - Reconciles with the target-registry on each refresh: adds new targets,
      removes disappeared ones, updates intervals if changed
- [ ] Create `packages/monitoring/src/adapters/victoriametrics-client.ts`:
    - `writeMetric(metric: Metric): Promise<void>`
    - Uses VM's `/api/v1/import/prometheus` text endpoint for simplicity
    - Reads VM endpoint from `MONITORING_VM_URL`
- [ ] Create `packages/monitoring/src/adapters/victorialogs-client.ts` (slim
      rewrite — the earlier version from the deleted Step 4 is gone):
    - `writeStateChange(event: StateChangeEvent): Promise<void>` — single-line
      NDJSON POST to `/insert/jsonline`, retries on 5xx, logs every failure
- [ ] Create `packages/monitoring/src/adapters/metric-writer.ts`:
    - Converts `HealthStatus` → `uptime_probe{client_id, project, status}` metric + `uptime_probe_latency_ms` histogram
    - Pushes via `victoriametrics-client`
- [ ] Create `packages/monitoring/src/cli/probe.command.ts`:
    - Starts the probe scheduler worker
    - Reads `tenants.toml`, subscribes to registry changes
- [ ] Unit tests on all domain functions (pure, no mocks)
- [ ] Integration tests with mocked fetch + real VM in Docker

**Definition of done**: `nn-monitor probe` spawns a worker that polls every
tenant's healthcheck every 5s; `uptime_probe{project="foo"}` shows up in
VictoriaMetrics; state-change events show up in VictoriaLogs.

**Files created**: ~9 files. Depends on Step 2 (schema) and Step 3 (VL is
standing up and reachable on the tailnet).

---

### PHASE 3 — ALERTING

#### Step 5: SLO → vmalert rule generator `[TODO]`

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
    - `generateRules(tenant: TenantIdentity, slo: SloConfig): { recordingRules, alertingRules }`
    - `TenantIdentity` is a simple value type `{ client_id, project }` derived
      from `tenants.toml` + the pulled `nextnode.toml`; there is no tenant row
      in a DB anymore (the token store was deleted in the Option A pivot)
    - Recording rules:
        - `job:slo_errors_per_request:ratio_rate1h{client_id, project}`
        - `...rate6h`, `...rate3d`
        - Based on RED metrics scraped from client app `/metrics`
    - Alerting rules (per SRE workbook, Section 2.9):
        - `SLOBurnRatePage`: fires when rate1h > 14.4 _ budget AND rate6h > 6 _ budget
        - `SLOBurnRateTicket`: fires when rate3d > 1 \* budget
        - Each carries `client_id`, `project`, `severity`, `runbook_url` labels
- [ ] Create `packages/monitoring/src/adapters/vmalert-rules-writer.ts`:
    - Writes all tenants' rules to a YAML file on disk (grouped by tenant)
    - Sends SIGHUP to the vmalert process (or HTTP reload endpoint if available)
- [ ] Create `packages/monitoring/src/cli/generate-rules.command.ts`:
    - Reads `tenants.toml` + the pulled `nextnode.toml` per tenant
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

**Files created**: ~6 files. Depends on Step 2 (schema) and Step 4 (reuses the
target-registry / nextnode-toml-fetcher adapters).

---

#### Step 6: Alert routing & notifications `[TODO]`

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
- [ ] **New**: create a slim Hono webhook service in this step (the old Hono
      app was deleted in the Option A pivot). `packages/monitoring/src/cli/webhook.command.ts` + `packages/monitoring/src/adapters/http-server.ts`:
    - `POST /webhook/vmalert` — parse payload; for each firing alert → open
      incident (or append to existing); for each resolved → close; for each
      state change → route via `alert-router` and send notifications; 204
    - `POST /webhook/external-probe` — receiver for the Cloudflare Worker probe
    - Listens on the Tailscale interface only — no public ingress, no auth
    - No status page routes here — the custom Astro dashboard (Step 10)
      handles all UI concerns
- [ ] Maintenance window support:
    - SQLite table: `maintenance_windows { client_id, project, start, end, reason }`
    - Alert router checks window before routing
    - `nn-monitor maintenance start/end` CLI subcommands
- [ ] Unit tests on alert-router and incident domain (pure)
- [ ] Integration tests with sample vmalert payloads
- [ ] Dedup test: two fires of the same alert = one incident

**Definition of done**: a vmalert fire produces a notification on the configured
channel, creates an incident row, and a subsequent resolve closes it. Maintenance
windows correctly suppress notifications.

**Files created**: ~11 files (includes the slim Hono rebuild). Depends on
Steps 2 (schema), 4 (target registry), 5 (vmalert rules).

---

### PHASE 4 — DEPLOYMENT

#### Step 7: Docker Compose + Caddy + full infrastructure `[TODO]`

**Goal**: a single `docker-compose.yml` that brings up the entire monitoring stack
on the Hetzner CX33, with Caddy handling TLS and reverse proxy, and volume
persistence for logs/metrics/SQLite.

**Tasks**:

- [ ] Create `packages/monitoring/deploy/docker-compose.yml`:
    - Services: `victoriametrics`, `victorialogs`, `vmalert`, `grafana` (dev/debug only), `monitoring-dashboard`, `monitoring-webhook`, `caddy`
    - Two networks: an internal bridge for service-to-service calls, and the
      host tailnet interface exposed via `network_mode: host` or equivalent for
      VL and VM so Vector on client VPSes can reach them through Tailscale
    - VL listens ONLY on the Tailscale interface — never on public ports
    - Volume mounts: `./data/vm`, `./data/vl`, `./data/grafana`, `./data/webhook-sqlite`, `./data/caddy`
    - Healthchecks on each service
    - Restart policy: `unless-stopped`
- [ ] Create `packages/monitoring/deploy/Caddyfile`:
    - `monitoring.nextnode.fr` → `monitoring-dashboard:4321` (custom Astro dashboard — Step 10)
    - `grafana.monitoring.nextnode.fr` → `grafana:3000` (basic auth, dev/debug only — not production UI)
    - Automatic TLS via Let's Encrypt
    - HTTP → HTTPS redirect
- [ ] Create `packages/monitoring/deploy/victoriametrics.yml`:
    - Scrape config: generated from `tenants.toml` via a small helper, targets each tenant's `/metrics` endpoint over Tailscale
    - 15s scrape interval
    - Relabelling to add `client_id`, `project`, `environment` labels
- [ ] Create `packages/monitoring/deploy/victorialogs.yml`:
    - `-retentionPeriod=30d`
    - `-retention.maxDiskSpaceUsageBytes=50GiB`
    - `-httpListenAddr=<tailnet-ip>:9428` — never 0.0.0.0
- [ ] Create `packages/monitoring/deploy/vmalert.yml`:
    - `-rule=/etc/vmalert/rules.yml` (the file written by Step 5)
    - `-datasource.url=http://victoriametrics:8428`
    - `-notifier.url=http://monitoring-webhook:3000/webhook/vmalert`
- [ ] Create `packages/monitoring/deploy/grafana/provisioning/datasources/`:
    - `victoriametrics.yml` — Prometheus datasource pointing at `vmsingle`
    - `victorialogs.yml` — Grafana VL plugin datasource
    - NOTE: Grafana is a dev/debug tool only. The production ops dashboard is
      the custom Astro app in Step 10. No provisioned dashboards needed here —
      ad-hoc explore panels are sufficient for debugging.
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
full stack; TLS is issued; `https://monitoring.nextnode.fr/health`
returns 200; Grafana is accessible behind basic auth.

**Files created**: ~10 files under `packages/monitoring/deploy/`. Depends on all
previous steps.

---

#### Step 8: Cloudflare Worker — second probe + dead-man's switch `[TODO]`

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
    - Fetches target list from KV (updated by the monitoring webhook service on every refresh of `tenants.toml`)
    - Fan-out probe to all targets + the monitoring VPS itself (its **public** HTTPS endpoint via Caddy — the worker lives outside the tailnet)
    - On monitoring VPS failure → **backup notification channel directly from worker**
      (Discord webhook URL as env var in wrangler — the ONLY reliable path when the
      main monitoring service is the thing that's down)
    - On target failure → POST result to monitoring webhook service `POST /webhook/external-probe` (public route)
- [ ] Create `packages/monitoring/worker/src/dead-mans-switch.ts`:
    - Tracks consecutive failures to the monitoring VPS in KV
    - After 3 consecutive failures (3 minutes) → direct Discord notification
    - Resets on recovery
- [ ] Create `packages/monitoring/worker/src/probe.ts`:
    - Single-target probe with timeout
    - Pure function
- [ ] Add `GET /internal/targets` to the webhook service:
    - Returns the target list for the worker to pull
    - Auth via a single admin token stored in the wrangler env (this is the
      ONE remaining bearer token in the whole stack — justified because the
      worker is not on the tailnet and the route is public)
    - Worker updates its KV from this endpoint on every run (or cache + refresh hourly)
- [ ] Deploy via `wrangler deploy`
- [ ] Smoke test: kill the monitoring VPS → verify Discord notification arrives within 3 minutes

**Definition of done**: CF Worker runs on schedule, its probes are visible in VM
under `uptime_probe_external`, killing the monitoring VPS for 3+ minutes produces
a Discord notification from the worker.

**Files created**: ~6 files under `packages/monitoring/worker/`, ~2 routes added
to the webhook service. Depends on Step 6 (webhook service), Step 7 (deployed monitoring VPS).

---

### PHASE 5 — EXTENDED FEATURES

#### Step 9: Synthetic monitoring `[TODO]`

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

**Files created**: ~5 files. Depends on Step 2 (schema), Step 4 (probe infra to share).

---

#### Step 10: Custom monitoring dashboard (Astro) `[TODO]`

**Goal**: a custom in-house web application that replaces Grafana as the
production ops UI **and** serves as the public-facing status page for clients.
Single Astro app with role-based views. Deployed on the monitoring VPS behind
Caddy at `monitoring.nextnode.fr`.

**Why not Grafana**: ugly UX, hard to white-label, overkill for 3-4 ops views,
impossible to resell as SaaS. Grafana stays in the compose stack as a dev/debug
tool for ad-hoc queries — it is NOT production-facing.

**Package**: `packages/monitoring-dashboard` (new Astro app, separate from the
Node.js monitoring service).

**Architecture**:

- Astro 5 + SSR (Node adapter) — deployed as a Docker container on the VPS
- Queries VictoriaLogs and VictoriaMetrics HTTP APIs directly over localhost
  (both are on the same Docker network)
- Reads incident data from the monitoring webhook's SQLite DB (mounted volume
  or exposed via an internal REST endpoint from the webhook service)
- Admin auth: simple session-based login (bcrypt password in `.env`) or
  Tailscale identity header via Caddy (decision deferred to implementation)
- Public routes: no auth required

**Views**:

_Admin (ops) — requires auth:_

- **Command center**: all projects' uptime + SLO burn at a glance
- **Log explorer**: search/filter logs by client, project, time range, level
  (queries VL's `/select/logsql/query`)
- **Metrics overview**: uptime graphs, latency p95/p99, error rates per project
  (queries VM's `/api/v1/query_range`)
- **Alerts & incidents**: open/closed incidents, firing alerts, maintenance
  windows
- **Per-project drill-down**: combines logs + metrics + incidents for one
  project

_Public — no auth:_

- **Status page** (`/status/:project`): current state, error budget remaining,
  last 10 incidents, 90-day uptime bar chart

**Tasks**:

- [ ] Scaffold `packages/monitoring-dashboard` as an Astro 5 project with
      Node adapter, TypeScript strict, Tailwind (NextNode theme via
      `@nextnode-solutions/standards`)
- [ ] Create `src/lib/victorialogs.ts` — typed VL query client (wraps
      `fetch` to VL's `/select/logsql/query`, `/select/logsql/stats_query`)
- [ ] Create `src/lib/victoriametrics.ts` — typed VM query client (wraps
      `fetch` to VM's `/api/v1/query`, `/api/v1/query_range`)
- [ ] Create `src/lib/incidents.ts` — reads incidents (from webhook service
      internal API or directly from SQLite read-only mount)
- [ ] Admin auth middleware (Astro middleware): session cookie,
      `POST /login` validates bcrypt hash against `ADMIN_PASSWORD_HASH` in env
- [ ] Admin view: Command center page (uptime grid, SLO burn indicators)
- [ ] Admin view: Log explorer page (time picker, filters, infinite scroll)
- [ ] Admin view: Metrics page (chart.js or similar for time-series graphs)
- [ ] Admin view: Alerts & incidents page
- [ ] Admin view: Per-project drill-down page
- [ ] Public view: Status page per project (`/status/:project`)
- [ ] Dockerfile for the dashboard (`astro build` → Node SSR server)
- [ ] Wire into `docker-compose.yml` (Step 7) as `monitoring-dashboard` service
- [ ] Unit tests on the VL/VM query client wrappers
- [ ] E2E test: mock VL/VM responses, assert rendered pages contain expected data

**Definition of done**: `https://monitoring.nextnode.fr` shows the admin
dashboard (behind login); `https://monitoring.nextnode.fr/status/foo-app`
shows the public status page; both pull live data from VL/VM.

**Files created**: new package `packages/monitoring-dashboard/` (~20-30 files).
Depends on Step 6 (incidents), Step 5 (SLO rules), Step 7 (compose stack).

---

#### Step 11: Client contract enforcement `[TODO]`

**Goal**: make the monitoring contract discoverable and enforceable across all
NextNode projects — `/health`, `/ready`, `/metrics` endpoints + Vector
agent running on the host + `[monitoring]` block in `nextnode.toml`.

**Tasks**:

- [ ] Update `@nextnode-solutions/standards` docs to list required endpoints
      for NextNode apps (`/health`, `/ready`, `/metrics`) and the Vector
      sidecar contract
- [ ] Optional: linting rule or CI gate in the infrastructure `prod-gate` command
      that checks a project has `[monitoring.slo]` and `[monitoring.healthcheck]`
      configured before allowing deploy
- [ ] Document the onboarding workflow end-to-end in `docs/`:
    1. Add the project to `packages/monitoring/deploy/tenants.toml` on the
       monitoring VPS (PR against the monitoring repo) — one entry with
       `client_id`, `project`, `repo`, `ref`
    2. Declare `[monitoring.slo]` and `[monitoring.healthcheck]` in the
       project's `nextnode.toml`
    3. Ensure the deploy pipeline joins the VPS to Tailscale and installs
       Vector with the rendered `vector.toml`
    4. Verify logs show up in Grafana under the new `client_id`/`project`
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
- Probe worker: a failed VM write is a logged + retried event, not a silently
  dropped metric. A repeatedly failing VM write raises a meta-alert.
- Webhook service: a vmalert webhook that fails to parse returns a 400 with
  a logged event so vmalert's own retry kicks in.

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

- Instrumented with `@nextnode-solutions/logger` (structured JSON logs) writing
  to stdout; **its own Vector sidecar** tails those logs and ships them to VL
  exactly like any other NextNode service. Recursion works.
- Exposes its own `/metrics` endpoint — scraped by the same VictoriaMetrics that
  scrapes client apps. Meta!
- Its own SLO declared in a `[monitoring.slo]` block. Recursion works.
- Its own synthetic tests (hit its own `/health` from the CF Worker).
- The dead-man's switch in Step 8 is the last line of defense.

### 9.4 Secrets management

| Secret                                          | Location                                         | Rotation                        |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| Tailscale auth keys (per client VPS)            | `tailscale up --authkey=...` at provision time   | Via `nextnode-deploy` reauth    |
| Cloudflare Worker → webhook service admin token | `wrangler secret put` + `.env` on monitoring VPS | Regenerate both sides, redeploy |
| Grafana admin password                          | `.env` on monitoring VPS only (never in git)     | Manual                          |
| SMTP credentials                                | `.env` on monitoring VPS                         | Manual                          |
| Discord/Slack webhook URLs                      | `.env` on monitoring VPS                         | Regenerate in respective apps   |
| Cloudflare Worker backup Discord URL            | `wrangler secret put`                            | `wrangler secret` update        |
| Synthetic test credentials                      | `.env` on monitoring VPS, per-tenant namespace   | Manual                          |

**Deliberately absent**: there are no per-tenant bearer tokens for the logs
pipeline. Log shipping relies on Tailscale network identity. See Section 2.8
for the full rationale and the Option A pivot decision log entry.

### 9.5 Backup strategy

- Hetzner Storage Box (1 TB, €3.40/mo) recommended
- Nightly `rsync` of `/opt/monitoring/data/` (VM snapshots, VL data, SQLite)
- Weekly snapshot of the SQLite DB via `.backup` command (online backup)
- Test restores quarterly (add to a checklist in `deploy/README.md`)

---

## 10. Glossary

| Term                             | Definition                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SLI**                          | Service Level Indicator. A measurement of service behavior (e.g. "fraction of HTTP requests returning 2xx/3xx").                                         |
| **SLO**                          | Service Level Objective. A target for an SLI (e.g. "99.9% of requests succeed over 30 days").                                                            |
| **Error budget**                 | `1 - SLO`. For 99.9% over 30 days, the budget is ~43 minutes/month of allowed "bad" time.                                                                |
| **Burn rate**                    | How fast, relative to the SLO, the service consumes the error budget. A burn rate of 1 means the error budget lasts exactly until the end of the window. |
| **Multi-window multi-burn-rate** | The Google SRE alerting technique: fire an alert only when burn rate exceeds threshold T in BOTH a short window and a longer window — kills flaps.       |
| **Golden signals**               | Latency, Traffic, Errors, Saturation. From the Google SRE book _Monitoring Distributed Systems_.                                                         |
| **RED method**                   | Rate, Errors, Duration. Brendan Gregg's method for request-driven services. A subset of golden signals.                                                  |
| **USE method**                   | Utilization, Saturation, Errors. For resources (CPU, RAM, disk).                                                                                         |
| **Black-box monitoring**         | External probe — simulates a user. "Does it work right now?"                                                                                             |
| **White-box monitoring**         | Internal metrics — what's happening inside the system. Catches imminent failures.                                                                        |
| **Recording rule**               | A precomputed PromQL/MetricsQL expression evaluated periodically and stored as a new metric — used to speed up complex queries.                          |
| **Alerting rule**                | A PromQL/MetricsQL expression that, when true for a `for:` duration, fires an alert.                                                                     |
| **Dead-man's switch**            | An external heartbeat that alerts when the monitoring system itself stops responding. Catches silent monitor crashes.                                    |
| **Multi-tenancy**                | One physical instance serving multiple isolated tenants (clients/projects), with data separation via labels + auth.                                      |
| **Runbook**                      | Documented response procedure for a specific alert. Every alert should have one.                                                                         |

---

## 11. Decision log

Decisions recorded here so future sessions don't re-litigate them. Add new entries
as the project evolves.

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-10 | Single shared monitoring VPS (not per-project)                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 10× cost saving at scale; command-center UX; matches industry standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-04-10 | Hetzner CX33 (not CAX21, not CCX13 default)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Cheapest adequate option at current pricing (€6.49 vs €7.99 vs €15.99); x86 avoids ARM friction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-10 | VictoriaMetrics family over Prometheus + Alertmanager                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Single vendor, lighter footprint, same query language, simpler single-node deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-04-10 | VictoriaLogs over Grafana Loki                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Simpler `/insert/jsonline` endpoint, no schema_config, no object storage required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-04-10 | Custom 5s uptime worker over Uptime Kuma                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Uptime Kuma minimum interval is 20s; Socket.IO-first API doesn't fit our pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-04-10 | vmalert webhook → Hono routing over Alertmanager                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Avoid yet another YAML DSL; keep routing logic in TypeScript we control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-10 | Tokens NEVER in `nextnode.toml`, GitHub secrets + env vars only — **SUPERSEDED by 2026-04-11 Option A pivot**                                                                                                                                                                                                                                                                                                                                                                                          | Security: config is committed, secrets must not be. Obsolete: there are no application tokens in the pivoted design, so the rule applies trivially.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-04-10 | Multi-window multi-burn-rate SLO alerts per Google SRE workbook                                                                                                                                                                                                                                                                                                                                                                                                                                        | Canonical method; symptom-based; mathematically derived; client-sellable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-04-10 | Cloudflare Worker as second probe + dead-man's switch (free tier)                                                                                                                                                                                                                                                                                                                                                                                                                                      | Zero-cost solution to single-probe blind spot; the ONLY reliable path to catch a dead monitoring VPS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-04-10 | Strict layered architecture mirroring `packages/infrastructure`                                                                                                                                                                                                                                                                                                                                                                                                                                        | Consistency with existing NextNode patterns; proven to produce testable code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-10 | `packages/monitoring/` location (not `apps/`, not separate repo)                                                                                                                                                                                                                                                                                                                                                                                                                                       | Consistency with `packages/infrastructure` precedent; workspace consumption of logger and config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-04-10 | NEVER published to npm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Private monorepo-consumed CLI + deployable, same pattern as `infrastructure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-11 | Domain `formatToken(randomBytes)` instead of `generateToken()` — **SUPERSEDED** (code deleted)                                                                                                                                                                                                                                                                                                                                                                                                         | CLAUDE.md forbids `crypto.randomBytes` inside domain functions; kept as a general rule for future randomness-in-domain cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-11 | `node:sqlite` DatabaseSync over better-sqlite3 — **PARTIALLY SUPERSEDED**                                                                                                                                                                                                                                                                                                                                                                                                                              | Token store SQLite is gone; the same preference still applies if a future adapter needs SQLite (incident store in Step 6, maintenance windows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-11 | CLI output is JSON lines on stdout, not tables                                                                                                                                                                                                                                                                                                                                                                                                                                                         | General CLI-ergonomics rule, still in force for future commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-11 | `process.stdout.write` over `console.log` in CLI output                                                                                                                                                                                                                                                                                                                                                                                                                                                | General rule, still in force                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-11 | Runtime type guards over `as` assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Repo-wide rule — oxlint `nextnode/no-type-assertion` enforces it, still mandatory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-04-11 | Retry loops via recursion, not `await` in for-loop — **GENERAL RULE**                                                                                                                                                                                                                                                                                                                                                                                                                                  | Avoids `no-await-in-loop` noise; future VL/VM clients should follow the same pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-04-11 | Unify `/health` and `/ready` everywhere (drop `/healthz`/`/readyz`)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Monitoring runs on Hetzner VPS via Docker Compose, not Kubernetes; the Google convention adds no value and costs readability for PME/ETI clients                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-04-11 | **Option A pivot: Vector + private network over Hono ingest API**. Deleted Steps 3 (token store) and 4 (Hono ingest) after they were implemented, tested, and proven. New Step 3 = Vector agent per client VPS, shipping NDJSON to VictoriaLogs directly over Tailscale. Files removed: `http-server`, `rate-limiter-store`, `rate-limiter`, `token-store`, `victorialogs-client`, `serve.command`, `token.command`, `log-envelope`, `tenant`, `token`, and all matching tests (~600 LOC + 138 tests). | NextNode owns every client VPS, so the application-level bearer-token boundary was pure ceremony — Tailscale network identity is the trust boundary, VictoriaLogs stays private. Operational gains: one fewer service to run, no token rotation, logs survive monitoring-VPS outages via Vector's disk buffer, logs of crashing apps are captured via `docker logs` (not lost when the app buffer dies). If a SaaS tier arrives, the ingest API is a one-to-two-day migration: stand up a new proxy service in front of VL, point Vector's HTTP sink at it, close VL on the tailnet side. Git history on `feat/monitoring-package` preserves the deleted code at commits `e990e4c`, `28eb766`, `b298a14`, `667d720`.                                                                                                                                        |
| 2026-04-11 | Probe worker's target source is **pull from GitHub raw `nextnode.toml`**, not push to an API                                                                                                                                                                                                                                                                                                                                                                                                           | Option A pivot removed the API. Pulling from the canonical `nextnode.toml` keeps config-as-code, survives redeploys without manual re-registration, and needs a single static `tenants.toml` file on the monitoring VPS listing which repos to watch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-04-11 | `monitoring.endpoint` field in `nextnode.toml` schema becomes LEGACY                                                                                                                                                                                                                                                                                                                                                                                                                                   | With Vector shipping logs directly to VL over Tailscale, the client app no longer needs to know where monitoring lives. The field stays in the schema unchanged for backwards compat and will be removed in a follow-up when the infrastructure schema is touched next. Schema tests left unchanged this round.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-12 | **Custom Astro dashboard over Grafana** for production ops UI + public status page. Grafana stays in compose as dev/debug tool only.                                                                                                                                                                                                                                                                                                                                                                   | Grafana UX is ugly, hard to white-label, overkill for the 3-4 views needed, and impossible to resell as SaaS. Building a custom Astro app gives: on-brand design, role-based views (admin ops + public status), foundation for SaaS resale, and a unified app instead of Grafana+separate-status-page. VL and VM expose clean HTTP query APIs — no Grafana required as middleware. ~2-3 days extra dev vs plug-and-play Grafana, justified by product ambition.                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-13 | **Vector over Fluent Bit** as the log shipper agent on every client VPS.                                                                                                                                                                                                                                                                                                                                                                                                                               | Vector wins on the dimensions that matter here: (1) native `docker_logs` source via the Docker API — auto container_name/image/labels metadata, vs FB's file-tailing approach which needs custom filters; (2) disk buffer more mature with published 500ms sync and at-least-once delivery; (3) VRL gives future headroom for PII scrubbing and enrichment without plugin code. FB is 3-5× lighter on RAM (10-20 MB vs 50-100 MB) but negligible on CX21+ VPSes. Licence: Vector is MPL-2.0 under Datadog stewardship (theoretical re-licence risk), FB is Apache-2.0 under CNCF graduated governance (vendor-neutral by construction) — acceptable given NextNode owns the deploy pipeline and can pin versions. VL sink uses `type = "elasticsearch"` against `/insert/elasticsearch/`, the path officially documented by VL (not the generic HTTP sink). |

---

## 12. References

- Google SRE Book, _Monitoring Distributed Systems_: https://sre.google/sre-book/monitoring-distributed-systems
- Google SRE Workbook, _Alerting on SLOs_: https://sre.google/workbook/alerting-on-slos
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
