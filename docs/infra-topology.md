# NextNode Infrastructure Topology

Reference architecture for NextNode project deployments. Covers VPS layout, Supabase services, Postgres, object storage, and backup strategy.

## Principles

- **Stateless apps, durable data on R2** — any VPS can be destroyed and rebuilt; state lives in R2 (WAL streams, logical dumps, uploads).
- **Env silos inviolable** — dev and prod never share application-level resources.
- **Host-layer sharing OK** — two composes on one VPS (same kernel, same Docker daemon) is acceptable if every app-layer resource is per-env.
- **Self-host everything** — no per-project paid DB; Postgres runs in Docker on the VPS.
- **1 app = 1 docker-compose** — the compose is the atomic deployment unit; may contain multiple apps if logically coupled.

## Environments

Current scope: **dev + prod**. Staging / preprod added later only if demanded.

## Baseline topology (non-critical projects)

One VPS per env, N project stacks colocated inside.

```
┌──── vps-dev (shared, all non-critical dev stacks) ───────────────┐
│                                                                   │
│  ┌─ proj-A compose ─┐  ┌─ proj-B compose ─┐  ┌─ proj-C compose ─┐│
│  │ app              │  │ app              │  │ app              ││
│  │ postgrest        │  │ postgrest        │  │ (no supabase)    ││
│  │ gotrue           │  │ gotrue           │  │                  ││
│  │ storage          │  │ storage          │  │                  ││
│  │ postgres         │  │ postgres         │  │ postgres         ││
│  └──────────────────┘  └──────────────────┘  └──────────────────┘│
│                                                                   │
│  host-level (shared): Docker daemon, Tailscale, Caddy, Vector     │
└───────────────────────────────────────────────────────────────────┘

┌──── vps-prod (shared, all non-critical prod stacks) ─────────────┐
│  (identical layout, prod values)                                  │
└───────────────────────────────────────────────────────────────────┘
```

- **Per-project Postgres container** (not shared Postgres with multiple DBs) → independent backup windows, independent upgrades, true isolation.
- **Supabase services bundled in the compose** when the project uses them; skipped when it doesn't.
- **R2 for object storage** via Supabase Storage's S3 backend (`GLOBAL_S3_ENDPOINT`, `GLOBAL_S3_FORCE_PATH_STYLE=true`, `TUS_ALLOW_S3_TAGS=false`).

## Escalation tiers

### Critical app → dedicated prod VPS

```
┌─ vps-prod-critical-X ────────────┐
│ only app X compose (prod)        │
│ (app + supabase + pg)            │
└──────────────────────────────────┘
```

Dev for app X stays on `vps-dev` (shared).

### Super-critical app → dedicated prod VPS + dedicated dev VPS

```
┌─ vps-prod-super-Y ───────┐   ┌─ vps-dev-super-Y ────────┐
│ only app Y compose (prod)│   │ only app Y compose (dev) │
└──────────────────────────┘   └──────────────────────────┘
```

Dedicated dev so dev work for Y isn't throttled by 9 other stacks, and dev↔prod topology matches for realistic testing.

## Persistence & backup

**Scope: prod only.** Dev data is treated as disposable — no WAL archival, no nightly dumps, no restore drills. If a dev VPS dies, the DB is re-seeded from migrations/fixtures. This keeps dev cheap (no WAL-G container, no R2 egress) and dev failures from cluttering the backup pipeline.

Uploads (Supabase Storage → R2) still flow to R2 from both envs, but under separate prefixes (`uploads/<project>/dev/` vs `uploads/<project>/prod/`) and dev uploads are not part of the backup/restore contract.

**Preconditions for the no-dev-backup policy:**
- **Idempotent, fast migrations** — `db reset` must be a no-drama operation. If resetting dev takes 30 minutes of manual fix-up, the policy fails.
- **Committed seed/fixture data** — a dev can bring up a realistic DB from the repo alone (e.g. `supabase db reset` + fixtures). Not optional.
- **Never clone prod → dev** — avoids PII/GDPR/HIPAA trap. If a project ever needs prod-like dev data, require explicit anonymization as a separate flow.
- **Individual dev keepsakes** — if a dev crafts a valuable test state (bug repro, multi-hour fixture set), they run an ad-hoc `pg_dump` to their own R2 folder. Personal, not infra-level.

```
 ┌─ prod pg container ─┐
 │  PGDATA (volume)    │
 └───────┬─────────────┘
         │ WAL-G streaming (every WAL segment)
         │ pg_dump logical (nightly)
         ▼
 ┌─────────────────────────────────┐
 │ Cloudflare R2                   │
 │  ├─ wal-archive/<project>/prod/ │
 │  ├─ dumps/<project>/prod/       │
 │  └─ uploads/<project>/<env>/    │ ← Supabase Storage S3 backend
 └─────────────────────────────────┘

 ┌─ dev pg container ─┐
 │  PGDATA (volume)   │   no backup — reseed from migrations/fixtures
 └────────────────────┘
```

- **WAL-G** → continuous WAL shipping via `archive_command`. RPO ≈ up to `archive_timeout` (default 300s / 5 min) — worst-case data loss is the currently-open WAL segment. For near-zero RPO use `wal-g wal-receive` (streaming) or a hot standby; 5 min RPO is acceptable for the current profile.
- **pg_dump** nightly → schema + data snapshot, disaster safety net.
- **Restore script** committed in repo: `provision → pull latest base backup → apply WALs`. The script itself is tested in CI.
- **Monthly restore drill** — restore targets a throwaway scratch VPS, **never dev, never prod**. Flow: `prod backups (R2) → scratch VPS → verify → destroy`. Time the recovery, document steps. Untested backups are not backups.
- **WAL archival MUST be configured before the first base backup** — otherwise PITR is impossible.
- **Escape hatch**: if a project's DB grows past ~100 GB, swap WAL-G for pgBackRest (better suited to very large DBs with fine-grained incremental recovery).

## Storage strategy

R2 is the durable source of truth for all persistent data. Local VPS SSD is an ephemeral hot cache. Hetzner Volumes are not used by default.

### Data-type → storage map

| Data | Where | Why |
|---|---|---|
| PGDATA (live pg files) | Local VPS SSD | Fast, included with VPS; prod = ephemeral cache of R2, dev = disposable |
| WAL archives | R2 | **Prod only.** Durable, continuous (WAL-G) |
| pg_dump snapshots | R2 | **Prod only.** Durable, nightly |
| Supabase Storage uploads | R2 via S3 backend | Durable, free egress |
| Caddy certs | R2 | Existing rule (avoid ACME rate limits) |
| Logs | Shipped off-box via Vector | Never land long-term on disk |
| Docker images / build cache | Local VPS SSD | Ephemeral, re-pullable from registry |

### Why no Hetzner Volumes by default

- R2 already provides durability (WAL + dumps + uploads).
- Local SSD provides performance — if the VPS burns, restore from R2.
- Volumes are block storage; they cannot replace R2 for object storage.
- Putting PGDATA on a Volume does not buy durability (Volumes are tied to one Hetzner DC) — only faster recovery (detach/reattach in seconds vs R2 restore in minutes).

### When to reach for a Volume (escape hatch)

1. Local SSD runs out on the current VPS SKU AND upgrading the whole VPS is wasteful (plenty of CPU/RAM headroom, just need disk).
2. Fast-recovery SLA on a specific critical app where R2 restore minutes are too slow.
3. DB too large for realistic R2 restore (e.g. >100 GB, where full restore takes hours).

For the current "small data" profile, Volumes stay unused.

### Final picture

```
 Durable / source-of-truth:   R2
   ├─ wal-archive/<project>/prod/      (prod only)
   ├─ dumps/<project>/prod/            (prod only)
   ├─ uploads/<project>/<env>/         (Supabase Storage S3 backend)
   └─ certs/                           (Caddy)

 Hot / ephemeral cache:       Local VPS SSD
   ├─ PGDATA                  ← rebuildable from R2
   ├─ Docker images           ← rebuildable from registry
   └─ OS / logs staging       ← logs shipped out via Vector

 Hetzner Volumes:             not used (escape hatch only)
```

## Env silo application layer (mandatory per-env separation)

| Resource | Separation rule |
|---|---|
| Docker networks | Different subnets per env |
| Docker volumes / bind mounts | `/opt/apps/<project>/<env>/` |
| Compose project name | Different `COMPOSE_PROJECT_NAME` per env |
| Postgres containers | One per env (never one pg with multiple schemas) |
| Env files / secrets | Per env |
| Caddy routes / cert paths on R2 | Per env |
| Vector tag set | Per-env labels |

Host-level (shared on same VPS, acceptable): Docker daemon, kernel, systemd, Tailscale agent, Caddy binary, Vector binary — as long as their **config** is per-env.

## Sizing

- Baseline `vps-dev` and `vps-prod`: sized to fit N project stacks + their Postgres instances. Plan ~150–300 MB RAM per idle pg + app overhead. Scale up the VPS SKU as projects accumulate; this doc stays topology-only.
- Critical/super-critical VPSs: sized to the app's actual needs.
- See `hetzner` skill for current pricing (EUR, VAT excluded, EU locations).

## Decision log

- **Not used**: Supabase Cloud (€20/project too expensive), Neon/Ubicloud managed Postgres (per-project cost), Hetzner Volumes for Postgres (state tied to single VPS, backup story weaker than R2 + WAL-G).
- **Chosen**: self-hosted Postgres in Docker per project, R2 for WAL + dumps + uploads, shared VPS per env with escalation tiers for critical/super-critical apps.
