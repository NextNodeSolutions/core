# @nextnode-solutions/monitoring

## What This Is

NextNode self-hosted monitoring service — a multi-tenant stack deployed on a
dedicated Hetzner VPS that watches every NextNode production project and backs
a competition-grade client SLA.

Currently a scaffold; implementation is driven top-to-bottom by
[`docs/monitoring-plan.md`](../../docs/monitoring-plan.md) at the repo root.
Read that file end-to-end before touching any code here — every architectural
choice is already locked.

**This package is NEVER published to npm.** It is consumed directly from the
monorepo by the deploy pipeline and runs as a container on the monitoring VPS.
Do not add `publishConfig`, `.releaserc.json`, or `[package]` section to
`nextnode.toml`.

## Architecture — STRICT LAYERED RULE (ABSOLUTE BAN)

The package is organized as **four strict layers**, mirroring `packages/infrastructure`.
Each layer has enforced import rules. Violations are bugs, not style preferences.

```
src/
  index.ts            — THIN entry: argv parsing + dispatch only, ZERO business logic
  cli/                — Command orchestrators: read env vars, call domain + adapters
    commands.ts       — Command registry + runCommand dispatcher
    env.ts            — Typed env var readers (requireEnv, getEnv)
    probe.command.ts  — (Step 4, planned) starts the uptime probe scheduler
    rules.command.ts  — (Step 5, planned) generates vmalert rules from SLO configs
    webhook.command.ts — (Step 6, planned) Hono app for vmalert webhook + status page
  domain/             — PURE business logic. NO IO, NO env vars, NO logger
    probe.ts          — (planned) Uptime state machine: (lastResult, newResult) → transition
    slo.ts            — SLO burn-rate math, error-budget computation
    burn-rate.ts      — (planned) Multi-window multi-burn-rate threshold computation
    vmalert-rule.ts   — (planned) Recording + alerting rule types
    slo-to-rules.ts   — (planned) SLO + tenant → vmalert rules
    alert.ts          — (planned) Alert/Incident types, dedup id, router
  adapters/           — IO boundary: fs, fetch, process signals
    nextnode-toml-fetcher.ts — (planned) Pulls nextnode.toml from each tenant's GitHub raw URL
    victoriametrics-client.ts — (planned) POST /api/v1/import/prometheus, PromQL query
    victorialogs-client.ts    — (planned) POST /insert/jsonline for probe state-change events
    probe-scheduler.ts — (planned) setInterval-based probe runner (owns Date.now + timers)
    vmalert-rules-writer.ts — (planned) Writes rules YAML + reloads vmalert
    http-server.ts    — (planned) Hono app wiring for webhook + status page routes
  config/             — (optional future) monitoring-local config loader
```

### Layer import rules — ENFORCED

| Layer        | May import from                       | STRICTLY FORBIDDEN                                                    |
| ------------ | ------------------------------------- | --------------------------------------------------------------------- |
| `index.ts`   | `cli/commands` only                   | `domain/`, `adapters/`, env vars, logger                              |
| `cli/*`      | `domain/`, `adapters/`, logger        | direct `node:sqlite`, `fetch`, raw `process.env` outside `cli/env.ts` |
| `domain/*`   | other `domain/*`, shared types        | `process.env`, `node:sqlite`, `fetch`, logger, any adapter            |
| `adapters/*` | shared types, `domain/*` (types only) | domain business logic, cross-adapter business decisions               |

The `nextnode.toml` schema lives in `packages/infrastructure/src/config/schema.ts`
(single source of truth). The monitoring package imports monitoring-related
types from there **as types only** — it never loads the config itself; the
deploy pipeline reads it and passes the values via env vars.

### Hard rules per layer

- **`index.ts` is ~4 lines.** It reads `process.argv[2]`, defaults to `'serve'`,
  and calls `runCommand`. If you find yourself adding an `import` other than
  `./cli/commands.js`, you are in the wrong file.
- **Domain is 100% pure.** Functions take inputs, return outputs. No side effects,
  no env reads, no logger calls, no `Date.now()`, no `crypto.randomBytes` called
  directly inside business functions — inject randomness/time as parameters so
  tests stay deterministic. Domain tests should never need stubs beyond plain
  value fixtures.
- **Adapters never contain business decisions.** They translate between the
  outside world (SQLite, HTTP, timers) and domain types. A conditional inside
  an adapter that goes beyond "did the IO succeed?" is a smell — push it into
  the domain. `probe-scheduler.ts` owns `Date.now()` and `setInterval`; the
  state-machine logic it invokes lives in `domain/probe.ts`.
- **CLI commands are orchestrators.** They read env vars (via `cli/env.ts`),
  wire adapters + domain together, and log at milestones. They hold ZERO
  business logic — all decisions live in `domain/`.
- **Infrastructure-specific strings (paths, URLs, table names) live in the CLI
  layer**, not the domain. Domain exposes parameters; CLI injects concrete values.

### Naming

- `*.command.ts` suffix for CLI command orchestrators
- `*.test.ts` alongside the file it tests, in the same folder/layer
- Domain files are named after the concept they own (e.g. `rate-limiter.ts`,
  not `limit.ts` or `throttle.ts`)
- NEVER `utils.ts`, `helpers.ts`, `common.ts`, `shared.ts`, `pipeline.ts` —
  these names hide responsibility

### When adding a feature

1. Start in `domain/` — write a pure function + test
2. Add an `adapter/` if new IO is needed (sqlite/http/timers)
3. Wire them together in a `cli/*.command.ts` orchestrator
4. Register the command in `cli/commands.ts`
5. `index.ts` NEVER changes when adding a new command

## Trust boundary — Tailscale/private network

The logs pipeline does NOT terminate in this package. Each client VPS runs a
**Vector agent** that tails `docker logs` + journald and ships NDJSON straight
into VictoriaLogs over a **private network** (Tailscale or WireGuard). There
is no application-level auth token: the network is the trust boundary, and
VictoriaLogs is never exposed to the public internet.

This means the monitoring package owns:

- The **probe worker** — pulls each tenant's `[monitoring.healthcheck]` target
  from their `nextnode.toml` (fetched over GitHub raw) and runs the 5s loop.
- The **vmalert rule generator** — reads each tenant's `[monitoring.slo]` block
  and emits the matching recording + alerting rules.
- The **webhook receiver + status page** — the slim Hono app that answers
  `POST /webhook/vmalert`, `POST /webhook/external-probe`, and `GET /status/:project`.

No token store. No bearer-auth middleware. No multi-tenant ingest API. If a
future SaaS tier is added and external clients arrive, the ingest boundary can
be reintroduced as a separate package — it is a deliberate YAGNI deletion,
not a missing feature.

## Error Handling

Follow the global CLAUDE.md rules without exception:

- No silent swallows. Every error is logged and propagated.
- No technical fallbacks without explicit business rule.
- Every adapter IO error is logged AND re-thrown (or mapped to a specific
  HTTP status at the server boundary — e.g. VictoriaLogs unreachable → 503,
  never a silent empty success).

## Testing

- **Domain tests**: pure unit tests with value fixtures. No mocks, no temp
  files, no env vars, no fake timers. If you need a mock to test a domain
  function, the logic is in the wrong layer. Clocks and randomness must be
  injected as parameters.
- **Adapter tests**: integration tests with real IO where feasible —
  `vi.stubGlobal('fetch', ...)` for network adapters, temp directories for
  any filesystem-backed state, fake timers where unavoidable.
- **CLI command tests**: end-to-end of a single command, setting env vars +
  stubbing fetch, asserting against temp output files and `process.exitCode`.
- Use vitest with `@nextnode-solutions/standards/vitest/backend`.

## Reference

- `docs/monitoring-plan.md` — the plan. Status tracker at the top.
- `packages/infrastructure/CLAUDE.md` — the pattern this package copies.
- Vector docs (client-side log shipper): https://vector.dev/docs/
- https://sre.google/workbook/alerting-on-slos — burn-rate alerting methodology.
