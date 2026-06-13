# postgres+wal-g (NextNode fleet image)

`postgres:18` with [WAL-G](https://github.com/wal-g/wal-g) baked in, providing
continuous WAL archiving and point-in-time recovery (PITR) to Cloudflare R2 for
embedded-postgres deploys. Published to `ghcr.io/nextnodesolutions/postgres-walg`
and consumed by reference from the deploy compose (**production only**).

## Why this image exists

`archive_command` runs inside the postgres process, so the `wal-g` binary must
live in the postgres container. Baking a pinned, checksummed binary into a
fleet-owned image is the canonical wal-g deployment and avoids the failure modes
of the streaming alternative (`wal-g wal-receive` as a sidecar):

- **no replication slot** → no unconsumed-slot disk-fill incident on a small VPS
  (the slot's WAL retention is the classic streaming footgun);
- **no `pg_hba.conf` surgery** for replication connections;
- postgres exposes archiving health natively via `pg_stat_archiver`, so the
  monitoring stack scrapes it with no extra moving parts.

## What it does

- **Server** (`CMD postgres`): the deploy passes
  `-c archive_mode=on -c archive_command='wal-g wal-push %p' -c archive_timeout=180`
  so every completed/forced WAL segment is pushed to R2 within ~180 s (the RPO).
  `entrypoint-walg.sh` wraps the official entrypoint: on an **empty** data
  directory with a base backup present in R2, it `wal-g backup-fetch LATEST` +
  drops `recovery.signal`, so a fresh VPS replays all archived WAL and comes up
  current instead of blank. Role passwords survive the physical restore and
  match because `POSTGRES_PASSWORD` is a persisted, non-rotating secret.
- **Backup loop** (`CMD walg-backup-loop.sh`, sidecar): periodic `wal-g
  backup-push` (anchors the WAL chain, bounds restore time) + `wal-g delete
  retain` (prune). Interval/retention come from env so policy stays in core.

## Configuration (env, supplied by core)

`WALG_S3_PREFIX` (e.g. `s3://nn-walg-<project>/<id>`), `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT` (R2), `AWS_REGION=auto`,
`AWS_S3_FORCE_PATH_STYLE=true`, `WALG_COMPRESSION_METHOD`. The presence of
`WALG_S3_PREFIX` is the "archiving enabled" switch — absent in dev, where no
archiving, restore, or base backup runs.

## Pinning

- `WALG_VERSION` + sha256 are pinned in the `Dockerfile`. Bump both together; get
  the checksum from the release's `wal-g-pg-22.04-amd64.sha256` asset.
- `POSTGRES_VERSION` build-arg tracks `NEXTNODE_POSTGRES_VERSION` in
  `packages/infrastructure/src/domain/services/postgres.ts`.
- amd64 only (the Hetzner fleet is x86_64). Add arm64 + the aarch64 wal-g asset
  if arm nodes are introduced.

## One-time setup

After the first successful build, set the GHCR package
`nextnodesolutions/postgres-walg` visibility to **public** (Package settings →
Change visibility) so VPSes pull it without registry auth — matching how the
upstream backup sidecar is consumed. (Alternatively keep it private and ensure
the deploy logs into ghcr.io for the postgres service.)
