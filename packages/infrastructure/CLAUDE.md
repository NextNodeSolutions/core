# @nextnode-solutions/infrastructure

## What This Is

NextNode infrastructure CLI — runs in GitHub Actions to orchestrate CI quality gates.
Currently implements the **plan** phase: parse `nextnode.toml`, generate a quality matrix (lint/test), and write outputs for downstream jobs.

## Current Scope

```
src/
  index.ts              — CLI entry point, reads PIPELINE_CONFIG_FILE env var
  config/               — nextnode.toml parsing and validation
  pipeline/             — Plan outputs (quality matrix -> GITHUB_OUTPUT)
```

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

1. `plan` job checks out this package, runs `tsx src/index.ts` with `PIPELINE_CONFIG_FILE`
2. Outputs `quality_matrix`, `project_name`, `project_type` to `GITHUB_OUTPUT`
3. `pipeline.yml` routes to one of three nested reusable workflows based on plan outputs:
    - `route-package.yml` (`type == "package"`): quality → publish
    - `route-app-dev.yml` (`type == "app"` + `environment == "development"`): quality → deploy
    - `route-app-prod.yml` (`type == "app"` + `environment == "production"`): quality → deploy
4. Each route is a self-contained workflow — no shared jobs, no `if` inside routes
5. Inactive routes appear as a single skipped line in the UI (not expanded)

## Error Handling

Follow the global CLAUDE.md rules without exception:

- No silent swallows. Every error is logged and propagated.
- No technical fallbacks without explicit business rule.

## Testing

- Unit tests for config parsing and validation
- Unit tests for quality matrix generation
- Integration tests with real temp files for plan output writing
- Use vitest with `@nextnode-solutions/standards/vitest/backend`

## Rewrite Context

This is a **rewrite** of the previous `NextNodeSolutions/infrastructure` repo.
The old codebase is at `/Users/walid-mos/Development/nextnode/infrastructure/`.

### Porting Rules

- **Read the old code** and understand what it does
- **Rewrite from the spec**, not from the implementation
- **Never copy error handling patterns** from the old code
- See `docs/audit-merged.md` at repo root for the full old-infra audit

### Concepts to Port (when needed, not before)

- Deploy target abstraction (VPS, Cloudflare Pages, serverless)
- `ENV_TABLE` two-phase env resolution
- Service strategy pattern (r2, supabase, redis)
- Terraform for VPS provisioning
- Tailscale mesh networking
- SSH connection pooling via ControlMaster
- Caddy JSON API (not Caddyfile text mutation)
- Docker Compose direct generation (not AST transforms)

### What We Drop

- Blue-green deployment (unnecessary at our scale)
- Sablier integration (not worth complexity at 7 EUR/VPS)
- AST-based compose transforms
- Checkpoint system (make steps idempotent instead)
- Caddyfile text mutation

### Key Secrets (for future deploy phases)

| Secret                                           | Purpose              |
| ------------------------------------------------ | -------------------- |
| `TF_CLOUD_TOKEN`                                 | Terraform Cloud auth |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`         | Tailscale OAuth      |
| `HETZNER_API_TOKEN`                              | VPS provider         |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | DNS + R2 + Pages     |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`      | Cert storage         |
| `VPS_SSH_KEY`                                    | SSH access to VPS    |
| `NEXTNODE_APP_ID` / `NEXTNODE_APP_PRIVATE_KEY`   | GitHub App           |
