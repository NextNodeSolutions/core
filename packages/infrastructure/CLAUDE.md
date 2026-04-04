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

## Origin

Rewrite of the old `NextNodeSolutions/infrastructure` repo (local: `/Users/walid-mos/Development/nextnode/infrastructure/`). See `docs/audit-merged.md` for the full old-infra audit. When porting features, rewrite from spec — never copy old error handling patterns.
