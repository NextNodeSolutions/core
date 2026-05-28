# @nextnode-solutions/infrastructure

NextNode infrastructure CLI — runs in GitHub Actions to orchestrate CI/CD: planning, provisioning, deployment, migrations, and backups.

This package is consumed directly from the monorepo by GitHub Actions workflows and is **never published to npm**.

## Postgres MVP

Embedded Postgres lifecycle: provision a sidecar in the project's compose stack, run drizzle migrations on each deploy, dump nightly to R2, and restore from any snapshot via the CLI.

### Commands

| Command                                                    | Purpose                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `infrastructure provision --project <slug>`                | Provision the project (compose stack, R2 buckets, DNS).            |
| `infrastructure migrate`                                   | Apply drizzle migrations against `DATABASE_URL` (advisory-locked). |
| `infrastructure restore --project <slug> --at <iso> --yes` | Fetch the closest backup ≤ `<iso>` from R2 and replay it.          |

`restore` is destructive (`pg_restore --clean --if-exists`) and refuses to run without `--yes`.

### Compose layout

- `postgres` — `postgres:18`, named volume `postgres-data`, internal-only (no host port binding).
- `postgres-backup` — `ghcr.io/solectrus/postgres-s3-backup:18`, runs `pg_dump` on the `@daily` schedule and uploads to `s3://nn-backups-<project>/postgres/`.

Retention is 7 daily / 4 weekly / 3 monthly UTC buckets, pruned after each backup.

## Architecture

See `CLAUDE.md` for the strict four-layer architecture (`index.ts` → `cli/` → `domain/` + `adapters/` → `config/`) and the import rules enforced across layers.
