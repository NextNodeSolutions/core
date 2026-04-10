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
    serve.command.ts  — (Step 4) starts the Hono ingest/probe server
    token.command.ts  — (Step 3) token create/list/revoke/rotate subcommands
  domain/             — PURE business logic. NO IO, NO env vars, NO logger
    token.ts          — generateToken, hashToken, verifyToken (pure crypto)
    tenant.ts         — Tenant type + tier/rate-limit rules
    log-envelope.ts   — LogEnvelope validation (matches logger HTTP transport wire format)
    rate-limiter.ts   — Pure sliding-window: (state, now) → (allowed, newState)
    probe.ts          — Uptime state machine: (lastResult, newResult) → transition
    slo.ts            — SLO burn-rate math, error-budget computation
    alert-rules.ts    — Multi-window multi-burn-rate vmalert rule generator
  adapters/           — IO boundary: SQLite, fetch, fs, Hono, process signals
    token-store.ts    — SQLite-backed tenant/token store (node:sqlite)
    victorialogs-client.ts  — POST /insert/jsonline with retries
    victoriametrics-client.ts  — POST write API, PromQL query API
    http-server.ts    — Hono app wiring (routes, middleware, graceful shutdown)
    probe-scheduler.ts — setInterval-based probe runner (owns Date.now() and timers)
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

## Secrets

- **Tokens are NEVER in `nextnode.toml`.** They are generated by the
  `nn-monitor token create` CLI, printed ONCE, stored as a GitHub repo secret
  in the client project, and injected at deploy time via the
  `NEXTNODE_MONITORING_TOKEN` env var.
- The monitoring server only stores a SHA-256 hash of each token — a DB dump
  cannot be used to authenticate.
- Rotation: `nn-monitor token rotate --id <id>` creates a new token for the
  same tenant, revokes the old one, prints the new plaintext once.

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
- **Adapter tests**: integration tests with real IO where feasible — temp
  SQLite files for `token-store`, `vi.stubGlobal('fetch', ...)` for network
  adapters, fake timers where unavoidable.
- **CLI command tests**: end-to-end of a single command, setting env vars +
  stubbing fetch, asserting against temp output files and `process.exitCode`.
- Use vitest with `@nextnode-solutions/standards/vitest/backend`.

## Reference

- `docs/monitoring-plan.md` — the plan. Status tracker at the top.
- `packages/infrastructure/CLAUDE.md` — the pattern this package copies.
- `packages/logger/src/transports/http.ts` — the wire format the ingest
  endpoint must accept.
- https://sre.google/workbook/alerting-on-slos — burn-rate alerting methodology.
