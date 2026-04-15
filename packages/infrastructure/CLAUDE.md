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
      target.ts       — DeployTarget interface + discriminated config/result types
      domain.ts       — resolveDeployDomain (hostname resolution)
      env.ts          — computeDeployEnv
      seo-guard.ts    — computeSeoGuardFiles
    cloudflare/       — Cloudflare Pages domain logic
      pages-domains.ts     — computePagesDomains, reconcilePagesDomain
      pages-project-name.ts — computePagesProjectName
      dns-records.ts        — computeDnsRecords, reconcileDnsRecord
    hetzner/          — Hetzner VPS domain logic
      caddy-config.ts       — Caddy JSON config types
      build-caddy-config.ts — buildCaddyConfig (pure)
      env-silo.ts           — EnvSilo type
      compute-silo.ts       — computeSilo (pure)
      compose-env.ts        — ComposeEnvInput type
      resolve-compose-env.ts — resolveComposeEnv (pure)
      vector-env.ts         — VectorTenantFields type
      render-vector-env.ts  — renderVectorEnv (pure)
    pipeline/         — Pipeline logic
      quality-matrix.ts — buildQualityMatrix, hasProdGate
      prod-gate.ts      — findDevRun, evaluateDevRun
      publish-result.ts — parseSemanticReleaseOutput, buildSummary
  adapters/           — IO boundary: fs, fetch, GitHub Actions outputs
    cloudflare/       — Cloudflare Pages adapter
      target.ts       — CloudflarePagesTarget (DeployTarget impl)
      pages-project.ts — provisionProject()
      pages-domains.ts — reconcileDomains()
      pages-dns.ts     — reconcileDns()
    hetzner/          — Hetzner VPS adapter
      hcloud-client.ts — typed fetch to Hetzner Cloud API
      hcloud-state.ts  — R2 state read/write with ETag locking
      ssh-session.ts   — ssh2 wrapper, ONE connection per deploy
    r2/               — R2 (S3) adapter
      r2-client.ts    — S3 SDK wrapper for state + certs
    github/           — GitHub Actions adapter
      api.ts          — fetchWorkflowRuns
      plan-outputs.ts — writePlanOutputs
      env.ts          — writeOutput, writeSummary
    build-output/     — Build output file injection
  config/             — nextnode.toml schema + loader (self-contained layer)
    providers/        — Per-target validation (strategy pattern)
```

### Layer import rules — ENFORCED

| Layer        | May import from                                  | STRICTLY FORBIDDEN                                                |
| ------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| `index.ts`   | `cli/*.command` only                             | `domain/`, `adapters/`, env vars, logger                          |
| `cli/*`      | `domain/`, `adapters/`, `config/`, logger        | direct `node:fs`, `fetch`, raw `process.env` outside `cli/env.ts` |
| `domain/*`   | other `domain/*`, `config/schema` (types only)   | `process.env`, `node:fs`, `fetch`, logger, any adapter            |
| `adapters/*` | `config/schema` (types), `domain/*` (types only) | domain business logic, cross-adapter calls                        |
| `config/*`   | nothing in-app (stdlib + smol-toml only)         | domain, cli, adapters                                             |

### Hard rules per layer

- **`index.ts` is the command registry + dispatcher.** It imports command functions, maps them by name, reads `process.argv[2]`, and calls the matched command. Throws on missing or unknown command — no silent defaults.
- **Domain is 100% pure.** Functions take inputs, return outputs. No side effects, no env reads, no logger calls. Domain tests should never need stubs beyond plain value fixtures.
- **Adapters never contain business decisions.** They translate between the outside world (fs, HTTP, GitHub Actions) and domain types. A conditional inside an adapter that goes beyond "did the IO succeed?" is a smell — push it into the domain.
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

Rewrite of the old `NextNodeSolutions/infrastructure` repo (local: `/Users/walid-mos/Development/nextnode/infrastructure/`). See `docs/audit-merged.md` for the full old-infra audit. When porting features, rewrite from spec — never copy old error handling patterns.
