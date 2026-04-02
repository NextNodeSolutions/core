# @nextnode-solutions/infrastructure

## What This Is

A **complete rewrite** of the NextNode infrastructure system (previously at `NextNodeSolutions/infrastructure`).
This package is the single entry point for all CI/CD, provisioning, and deployment logic.

## Why We're Rewriting

The previous infrastructure works but has accumulated critical debt:

- `deploy.ts` was a 2587-line god object with 3 deploy strategies entangled
- 39 SSH calls per deploy with no connection pooling (15-45s wasted)
- Caddy management via string mutation with brace counting — fragile
- Zero monitoring, no auto-rollback, no database backups
- Error handling inconsistent (silent swallows, warn-only on critical failures)
- Over-engineered in places (blue-green at 1K scale, Sablier, AST compose transforms)

Full audit details: `docs/audit-merged.md` at repo root.

## Core Design Principles

### 1. GitHub Action is a thin shell

The `.github/workflows/pipeline.yml` is called by ALL NextNode projects via `workflow_call`.
It does ONE thing: checkout, install, and call `tsx src/index.ts`.
**ALL logic lives in TypeScript.** The workflow never grows beyond ~50 lines.

### 2. Deploy target abstraction (future-proof)

The system supports multiple deploy targets behind a common interface:

```
DeployTarget { plan() -> provision() -> deploy(image) -> verify() -> URL }
  HetznerVPSTarget    — Docker Compose on bare-metal (current, primary)
  CloudflarePagesTarget — Static/SSR sites on Cloudflare Pages (planned)
  ServerlessTarget     — AWS Lambda, Cloud Run, etc. (planned)
```

The target is selected via `nextnode.toml`:

```toml
[target]
type = "vps"        # or "cloudflare-pages", "serverless"
```

### 3. Build and deploy are decoupled

Image is an immutable artifact, independent of deploy target.
Pipeline: `build -> push to registry -> deploy (target-agnostic)`.

### 4. Strategy pattern for deploy modes

Each deploy mode is a separate strategy — no entangled if/else:

- `MaintenanceStrategy` — show maintenance page, swap, restore
- `RollingStrategy` — zero-downtime restart (replaces old blue-green)
- `PRPreviewStrategy` — ephemeral preview environments

### 5. SSH connection pooling

All SSH commands within a deploy share a single connection via ControlMaster.

### 6. Caddy via JSON API

Use Caddy's admin API instead of Caddyfile text mutation.
Atomic validation + rollback built-in, no string parsing.

## Architecture

```
src/
  index.ts              — CLI entry point, reads env vars, dispatches to pipeline
  pipeline/             — Pipeline orchestration (plan, quality, build, deploy)
  targets/              — Deploy target implementations (vps, cloudflare-pages, serverless)
  services/             — Cloud service strategies (r2, supabase, redis, etc.)
  config/               — nextnode.toml parsing, validation, env resolution
  providers/            — External API clients (hetzner, cloudflare, tailscale, terraform)
  ssh/                  — SSH session with connection pooling
  caddy/                — Caddy JSON API client
  compose/              — Docker Compose generation (not AST transform — direct generation)
  lib/                  — Shared utilities (logging, constants, errors)
```

## Config-Driven via nextnode.toml

All behavior is driven by `nextnode.toml` in the calling project.
The default values come from `nextnode.default.toml` at the core repo root.
This is the same config system as the previous infra — it works well.

## Porting Rules — NO Blind Copy

This is a rewrite, not a migration. Even for concepts we keep, every file must be evaluated before porting:

- **Read the old code** and understand what it does
- **Decide if the design is sound** — the old infra has vicious bugs born from implicit assumptions
- **Rewrite from the spec**, not from the implementation — use the old code as reference, not as source
- **If a pattern caused bugs** (see `docs/audit-merged.md` bug timeline), redesign it entirely
- **Never copy error handling patterns** from the old code — they are the #1 source of production issues

The old codebase is at `/Users/walid-mos/Development/nextnode/infrastructure/`.

## What We Keep (Concepts, Not Code)

- `nextnode.toml` config system — excellent concept, rewrite the parser
- `ENV_TABLE` two-phase env resolution — clean design, rewrite
- Service strategy pattern — extensible concept
- Terraform for VPS provisioning — right tool
- Tailscale mesh networking — no public SSH
- R2 for Caddy cert storage — survives VPS destruction
- Docker Compose at VPS scale — right choice (not K8s)
- Hetzner for cost efficiency — 7 EUR/app/month

## What We Drop

- Blue-green deployment (unnecessary at our scale, adds ~400 lines of complexity)
- Sablier integration (saves ~5% on a 7 EUR VPS, not worth the complexity)
- AST-based compose transforms (generate prod compose directly instead)
- Checkpoint system (make steps idempotent instead)
- Caddyfile text mutation (use JSON API)

## Error Handling — Strict Rules

Follow the global CLAUDE.md rules without exception:

- No silent swallows. Every error is logged and propagated.
- No technical fallbacks without explicit business rule.
- Critical operations (credentials, provisioning, deploy) fail hard.
- Only cleanup operations may catch-and-warn (and must still log).

## Testing

- Integration tests for each deploy target
- Unit tests for config parsing, env resolution, compose generation
- Mock SSH via interface, not implementation
- Test each deploy strategy independently
- Use vitest with `@nextnode-solutions/standards/vitest/backend`

## Key Secrets (passed via GitHub Actions `secrets: inherit`)

| Secret                                           | Purpose              |
| ------------------------------------------------ | -------------------- |
| `TF_CLOUD_TOKEN`                                 | Terraform Cloud auth |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`         | Tailscale OAuth      |
| `HETZNER_API_TOKEN`                              | VPS provider         |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | DNS + R2 + Pages     |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`      | Cert storage         |
| `VPS_SSH_KEY`                                    | SSH access to VPS    |
| `NEXTNODE_APP_ID` / `NEXTNODE_APP_PRIVATE_KEY`   | GitHub App           |
