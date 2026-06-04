# @nextnode-solutions/infrastructure

## What This Is

NextNode infrastructure CLI — runs in GitHub Actions to orchestrate CI/CD: planning, provisioning, and deployment.
Commands: `plan` (quality matrix), `provision` (infra setup via DeployTarget), `deploy` (env vars + secrets sync), `prod-gate`, `publish-result`.

**This package is NEVER published to npm.** It is consumed directly from the monorepo by GitHub Actions workflows. Do not add `publishConfig`, `.releaserc.json`, or `[package]` section to `nextnode.toml`.

## Architecture — STRICT LAYERED RULE (ABSOLUTE BAN)

The package is organized as **four strict layers**. Each layer has enforced import rules. Violations are bugs, not style preferences.

```
src/
  index.ts            — Command registry + argv dispatch. No business logic.
  cli/                — Command orchestrators: read env vars, call domain + adapters
    env.ts            — Typed env var readers (requireEnv, getEnv)
    secrets.ts        — parseAllSecrets, pickSecrets (GitHub Secrets → Record)
    deploy/           — Deploy-related commands
      create-target.ts  — Factory: config + env → DeployTarget instance
      provision.command.ts  — target.ensureInfra()
      deploy.command.ts     — SITE_URL → GITHUB_ENV + target.deploy()
    pipeline/         — Pipeline-related commands
      plan.command.ts
      prod-gate.command.ts
      publish-result.command.ts
  domain/             — PURE business logic. NO IO, NO env vars, NO logger
    environment.ts    — resolveEnvironment + PipelineEnvironment type
    deploy/           — Shared deploy concepts (provider-agnostic)
      target.ts       — DeployTarget interface + DeployInput + DeployResult
      domain.ts       — resolveDeployDomain (hostname resolution)
      image-ref.ts    — parseImageRef
      seo-guard.ts    — computeSeoGuardFiles
    cloudflare/       — Cloudflare domain logic
      pages-domains.ts     — computePagesDomains, reconcilePagesDomain
      pages-project-name.ts — computePagesProjectName
      dns-records.ts        — computeDnsRecords, reconcileDnsRecord
      r2/                   — R2 provisioning pure logic
        credentials.ts      — deriveR2Credentials (token → S3 creds via SHA256)
        endpoint.ts         — computeR2Endpoint / computeR2Host
        token-policy.ts     — buildR2TokenPolicy
    caddy/            — Caddy reverse-proxy domain logic (provider-agnostic)
      config.ts             — Caddy JSON types + buildCaddyConfig (pure) + issuer factories
      compose.ts            — composeCaddyConfig (orchestrates upstreams + supabase + issuer)
      env.ts                — renderCaddyEnv + CADDY_ENV_PATH (systemd EnvironmentFile)
      supabase.ts           — Supabase-specific Caddy routes (api/kong + studio basic-auth)
    hetzner/          — Hetzner VPS domain logic
      env-silo.ts           — EnvSilo type
      compute-silo.ts       — computeSilo (pure)
      compose-env.ts        — formatComposeEnv (KEY=val serializer)
      vector-env.ts         — VectorTenantFields type
      render-vector-env.ts  — renderVectorEnv (pure)
    pipeline/         — Pipeline logic
      quality-matrix.ts — buildQualityMatrix, hasProdGate
      prod-gate.ts      — findDevRun, evaluateDevRun
      publish-result.ts — parseSemanticReleaseOutput, buildSummary
  adapters/           — IO boundary: fs, fetch, GitHub Actions outputs
    cloudflare/       — Cloudflare API adapter
      target.ts       — CloudflarePagesTarget (DeployTarget impl)
      pages-project.ts — provisionProject()
      pages-domains.ts — reconcileDomains()
      pages-dns.ts     — reconcileDns()
      accounts.ts           — resolveAccountId
      permission-groups.ts  — resolveR2PermissionGroupIds
      r2/                   — R2 bucket + token provisioning via CF API
        buckets.ts          — ensureR2Bucket
        tokens.ts           — createR2Token (POST /user/tokens)
    hetzner/          — Hetzner VPS adapter
      hcloud-client.ts — typed fetch to Hetzner Cloud API
      hcloud-state.ts  — R2 state read/write with ETag locking
      ssh-session.ts   — ssh2 wrapper, ONE connection per deploy
    r2/               — R2 (S3) adapter
      client.ts            — S3 SDK wrapper for state + certs
      verify-credentials.ts — SigV4 handshake for R2 credential self-heal
    github/           — GitHub Actions adapter
      api.ts          — fetchWorkflowRuns
      plan-outputs.ts — writePlanOutputs
      env.ts          — writeOutput, writeSummary
    build-output/     — Build output file injection
  config/             — nextnode.toml schema + loader (self-contained layer)
    providers/        — Per-target validation (strategy pattern)
  kernel/             — Layer-agnostic floor: pure primitives, stdlib only, zero in-app deps
    guards.ts         — isRecord (canonical record type guard)
    json.ts           — parseJsonOrThrow (JSON.parse with a contextual error)
```

### Layer import rules — ENFORCED

| Layer        | May import from                                                                               | STRICTLY FORBIDDEN                                                |
| ------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `kernel/*`   | nothing in-app (Node stdlib only)                                                             | every in-app module — it is the layer-agnostic floor              |
| `index.ts`   | `cli/*.command`, `kernel/*`                                                                   | `domain/`, `adapters/`, env vars, logger                          |
| `cli/*`      | `domain/`, `adapters/`, `config/`, `kernel/*`, logger                                         | direct `node:fs`, `fetch`, raw `process.env` outside `cli/env.ts` |
| `domain/*`   | other `domain/*`, `kernel/*`, `config/schema` (types only)                                    | `process.env`, `node:fs`, `fetch`, logger, any adapter            |
| `adapters/*` | `kernel/*`, `config/schema` (types), `domain/*` (types + pure formatters/renderers/selectors) | domain business _decisions_, cross-adapter calls                  |
| `config/*`   | `kernel/*` + stdlib + smol-toml + valibot (nothing else)                                      | domain, cli, adapters                                             |

`kernel/*` is the floor below every layer: pure primitives (type guards, generic parsers) with **zero in-app imports** — Node stdlib only, no IO/env/logger. It exists so a runtime helper like `isRecord` can be shared across the `config`↔`domain` boundary that the "types only" rule otherwise blocks, instead of being copy-pasted. Anything provider- or domain-specific does NOT belong here — it stays in its layer.

### Hard rules per layer

- **`index.ts` is the command registry + dispatcher.** It imports command functions, maps them by name, reads `process.argv[2]`, and calls the matched command. Throws on missing or unknown command — no silent defaults.
- **Domain is 100% pure.** Functions take inputs, return outputs. No side effects, no env reads, no logger calls. Domain tests should never need stubs beyond plain value fixtures.
- **Adapters never contain business decisions.** They translate between the outside world (fs, HTTP, GitHub Actions) and domain types. A conditional inside an adapter that goes beyond "did the IO succeed?" is a smell — push it into the domain.
- **Adapters MAY call pure `domain/*` helpers to translate.** Importing a pure, side-effect-free domain formatter / renderer / selector (e.g. `formatImageRef`, `renderComposeFile`, `selectServiceImage`) to turn a domain value into the string or structure the outside world expects is translation, not a business decision — it is allowed. The ban is on _decisions_: any branch beyond "did the IO succeed?", or any policy/env-driven choice, must live in `domain/`. The "types only" wording in the table is about not pulling in stateful or decision-bearing domain code — not about banning pure value renderers (which the adapters layer already relies on throughout).
- **CLI commands are orchestrators.** They read env vars (via `cli/env.ts`), call domain functions, pass results to adapters, and log at milestones. They hold ZERO business logic — all decisions live in `domain/`.
- **Infrastructure-specific strings (shell commands, file paths, URLs) live in the CLI layer**, not the domain. The domain exposes a parameter (e.g. `prodGateCommand` on `PipelineContext`); the CLI injects the concrete value.

### Naming

- `*.command.ts` suffix for CLI command orchestrators
- `*.test.ts` alongside the file it tests, in the same folder/layer
- Domain files are named after the concept they own (e.g. `quality-matrix.ts`, not `matrix.ts` or `quality.ts`)
- NEVER `utils.ts`, `helpers.ts`, `common.ts`, `shared.ts`, `pipeline.ts` — these names hide responsibility

### When adding a feature

1. Start in `domain/` — write a pure function + test
2. Add an `adapter/` if new IO is needed (fs/http/env)
3. Wire them together in a `cli/*.command.ts` orchestrator
4. Register the command in `index.ts`

## Config Format

```toml
[project]
name = "my-app"

[scripts]
lint = "lint"       # or false to disable
test = "test"       # or false to disable
build = "build"     # or false to disable
```

All scripts default to their key name. Set to `false` to skip.

## Deploy env: build args, secrets & needs (per service)

A deployable declares its env wiring PER SERVICE under `[deploy.services.<name>]`.
The dev declares only NAMES — values always live in GitHub (Secrets / Variables),
**never** in `nextnode.toml`. There are two distinct "doors":

- **BUILD door** — values inlined into the image at build time (Astro `site`,
  `NEXT_PUBLIC_*`, `VITE_*`). A `.env` does NOT traverse the Docker build (the
  root `.dockerignore` excludes it); only build args do.
    - `build_args = ["ANALYTICS_ID", …]` lists the dev's extra build arg NAMES,
      resolved against `ALL_VARS` (`toJSON(vars)`, repo/org-level Variables) and
      written to the service's docker-bake target. Fail loud if a name is absent.
    - `SITE_URL` is **auto-injected** by the infra into every build target (from
      `project.domain`, env-resolved via `computeSiteUrl`) — the dev never lists
      it. `computeSiteUrl` is the single source shared with the runtime
      `contributeEnv().SITE_URL`, so build-baked and runtime values cannot drift.
    - **Secrets must NEVER be build args** — they would bake into image layers /
      `docker history` / GHCR. Build-time secrets use `RUN --mount=type=secret`.

- **RUNTIME door** — values injected via compose `env_file` at run time.
    - `secrets = ["STRIPE_SECRET_KEY", …]` lists per-service (least-privilege)
      secret NAMES, resolved from `ALL_SECRETS` and projected into THIS service's
      `.env.<name>` only.
    - **`[deploy].secrets` is the GLOBAL pool** (both targets): every name there is
      injected into EVERY service. `resolveSecrets` folds the global names into each
      service's own `secrets` (global ∪ own, deduped), so the per-service routing in
      `service-env.ts` needs no extra wiring. The hetzner-vps pull pool = that union;
      cloudflare-pages has no services, so the pool IS `[deploy].secrets`.
    - **Auto-generated secrets** (see next section) are declared inline in
      `[deploy].secrets`; the name still routes like any global secret.
    - `needs = ["postgres"]` opts a service into a backing service's secrets. A
      backing secret (e.g. postgres `DATABASE_URL`) is projected ONLY into the
      `.env.<name>` of services that declare `needs` on its producer — **no
      broadcast**, so a front service never sees the database URL. Provenance
      (secret key → producing service) is the `secretOrigins` map threaded from
      `resolve-deploy-context` → `DeployInput` → the container target.
    - The embedded-postgres sidecar (`env_file: ['.env']`), the backup sidecar
      (`${VAR}` compose interpolation) and the ephemeral migrate container
      (`--env-file .env`) read a SHARED `.env` carrying the BACKING env only
      (`POSTGRES_*`, `R2_*`, `DATABASE_URL`) — never the app's user secrets.

## R2 buckets & public CDN URLs

`[services.r2]` declares buckets as a table-array; each bucket opts into a
public CDN domain with `cdn = true` (default `false` → private):

```toml
[[services.r2.buckets]]
name = "assets"
cdn  = true          # -> assets.cdn.<domain>, served publicly

[[services.r2.buckets]]
name = "private-cache" # no cdn -> private, no public URL
```

The dev declares only the alias + flag — never a domain. At provision time
the infra attaches a Cloudflare **custom domain** to each `cdn` bucket
(`<alias>.cdn.<resolveDeployDomain(project.domain)>`), the only prod-allowed
path (`r2.dev` is rate-limited / non-prod). Passing the zone id to the attach
call lets Cloudflare auto-create the proxied CNAME — no separate DNS write —
and provision polls until the SSL cert is `active` before persisting state.

Env projection (`buildR2ServiceEnv`): every bucket gets `R2_BUCKET_<ALIAS>`
(bucket name) + the shared `R2_ENDPOINT` in the public channel and
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in the secret channel; a `cdn`
bucket additionally gets `R2_BUCKET_<ALIAS>_URL` (its `https://` CDN URL).
Custom domains are detached on `project`-scope teardown. Requires the
project's zone to live in the same Cloudflare account (already true for any
project with `project.domain`).

## Secrets: global pool + auto-generation

A `[deploy].secrets` entry is either a **must-exist** name (a string — the
operator set it in GitHub) or an **auto-generated** table the infra creates and
pushes itself:

```toml
[deploy]
secrets = [
  "PREVIEW_SECRET",                                    # must-exist, global
  { name = "JWT_SECRET",  generate = "token",    length = 43 },  # generated
  { name = "DB_PASSWORD", generate = "password", length = 24 },  # generated
]
```

- **Generators** (`domain/deploy/secret-generation.ts`, pure): `token` →
  base64url `[A-Za-z0-9_-]` (JWT/HS256 keys); `password` → alphanumeric
  `[A-Za-z0-9]` (service/DB passwords). `length` = produced CHARACTER count
  (8–256). Crypto bytes are rejection-sampled for `password` (62 ≠ power of two)
  to avoid modulo bias; `token` (64) maps 1:1.
- **Parsing** (`config/validation/deploy.ts`): each entry's name joins the pull
  pool; table entries also become `deploy.generatedSecrets`. Duplicate names,
  unknown generators, and out-of-range lengths fail loud at parse.
- **Provision** (`cli/deploy/ensure-generated-secrets.ts`): for each generated
  secret ABSENT from `ALL_SECRETS`, generate the value and `gh secret set
  <name> --env <env>` (reuses the supabase `EnvSecretsAdapter`). **Idempotent +
  non-rotating** — a secret already in `ALL_SECRETS` is left untouched
  (regenerating would invalidate every live token / break the DB connection).
  Fails loud if gh is unavailable but a push is needed.
- **Contract**: a secret pushed during provision lands in a LATER run's
  `ALL_SECRETS` snapshot (GitHub freezes secrets at job start), so the flow is
  *provision → re-trigger deploy* — the same contract the supabase service uses.

## How It Runs

Called by `.github/workflows/pipeline.yml` via `workflow_call`:

1. `plan` job checks out this package, runs `node src/index.ts plan` with `PIPELINE_CONFIG_FILE`
2. Outputs `quality_matrix`, `project_name`, `project_type` to `GITHUB_OUTPUT`
3. `pipeline.yml` routes to one of three nested reusable workflows based on plan outputs:
    - `route-package.yml` (`type == "package"`): quality → publish
    - `route-app-dev.yml` (`type == "app"` + `environment == "development"`): quality → deploy
    - `route-app-prod.yml` (`type == "app"` + `environment == "production"`): quality → deploy
4. Each route is a self-contained workflow — no shared jobs, no `if` inside routes
5. Inactive routes appear as a single skipped line in the UI (not expanded)

## YAML vs TypeScript — STRICT RULE (ABSOLUTE BAN)

All pipeline/CI logic MUST live in TypeScript infrastructure code (`src/`). YAML workflow files (`.github/workflows/*.yml`) are STRICTLY limited to job structure: job definitions, step declarations, action references, input/output wiring, and reusable workflow calls.

FORBIDDEN in YAML:

- Conditional logic beyond simple routing (e.g. complex `if` expressions, shell script blocks with branching)
- Data transformation, string manipulation, or computation in `run` steps
- Business rules, validation, or decision-making of any kind
- Multi-line shell scripts that implement behavior

If a workflow needs to make a decision or transform data, that logic belongs in a TypeScript module invoked by the workflow — not inline in the YAML.

## Error Handling

Follow the global CLAUDE.md rules without exception:

- No silent swallows. Every error is logged and propagated.
- No technical fallbacks without explicit business rule.

## Testing

- **Domain tests**: pure unit tests with value fixtures. No mocks, no temp files, no env vars. If you need a mock to test a domain function, the logic is in the wrong layer.
- **Adapter tests**: integration tests with real temp files (`tmpdir()`) for `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY`. Network adapters are stubbed via `vi.stubGlobal('fetch', ...)`.
- **CLI command tests**: end-to-end of a single command, setting env vars + stubbing fetch, asserting against temp output files and `process.exitCode`.
- **Config tests**: unit tests for TOML parsing + validation, including fixtures in `src/config/fixtures/`.
- Use vitest with `@nextnode-solutions/standards/vitest/backend`.

## Origin

Rewrite of the old `NextNodeSolutions/infrastructure` repo (local: `/Users/walid-mos/Development/nextnode/infrastructure/`). See `docs/archive/` for the old-infra audits and specs (most recent: `docs/archive/audit-2026-04-01.md`). When porting features, rewrite from spec — never copy old error handling patterns.
