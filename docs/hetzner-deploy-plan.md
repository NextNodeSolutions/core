# Hetzner Deploy v1 — Plan

## 0. Mental model

- Deploy unit = `(project, environment)`. One VPS hosts one project, multiple envs.
- Envs are **inviolable app-layer silos** (separate networks, volumes, compose projects, containers, secrets). Host-layer agents (Caddy, Vector, Docker daemon) are shared with strict per-env config.
- `DeployTarget` interface in domain, provider adapters in adapters. Adding ECS later = new adapter, zero CLI change.
- Same Docker image sha reused across envs with different env vars.
- Budget: 3 min hot path, ~5 min cold path.

## 1. Config — `nextnode.toml` extensions

```toml
[project]
name = "acme-web"
type = "app"
domain = "acme.example.com"

# type "static" defaults to cloudflare-pages (backward compat with existing prod projects).
# Future: static + hetzner-vps will be possible.
[deploy]
target = "hetzner-vps"         # "hetzner-vps" | "cloudflare-pages"
secrets = ["DATABASE_URL"]

[deploy.hetzner]
server_type = "cpx22"
location = "nbg1"
```

Hostname convention (derived, not declared):
- `prod` → `project.domain` (e.g. `acme.example.com`)
- `dev` → `dev.<project.domain>` (e.g. `dev.acme.example.com`)
- Future envs follow pattern: `<env>.<project.domain>`

Validation: `target = "hetzner-vps"` requires `[deploy.hetzner]` + `project.domain`.

## 2. Project repo structure

```
<project>/
  nextnode.toml
  deploy/
    compose.yml                  — source of truth, uses ${VARS}, never mutated
```

Zero AST transform. Docker Compose resolves `${VARS}` natively via `--env-file`.

Env vars come exclusively from CI (GitHub Secrets + GitHub Environments). Auto-generated secrets (SITE_URL, POSTGRES_PASSWORD, etc.) are computed at deploy time by the infra code. Nothing committed to the repo.

## 3. Code layout in `packages/infrastructure/src/`

```
cli/
  commands.ts                                 — +hetzner-* entries
  env.ts                                      — +HCLOUD_TOKEN, SSH_KEY_PATH, etc.
  hetzner/
    provision.command.ts                      — create VPS + cloud-init + convergence
    deploy.command.ts                         — deploy an env (idempotent)
    describe.command.ts                       — current state
    teardown.command.ts                       — destroy VPS

domain/
  deploy-target.ts                            — interface + types (provider-agnostic)
  hetzner-deploy-plan.ts                      — pure: (current, desired) → steps
  caddy-routes-builder.ts                     — pure: (envs, hostnames, upstreams) → Caddy JSON
  compose-env-resolver.ts                     — pure: (secrets, auto-generated, env) → .env content
  vector-env-renderer.ts                      — pure: (tenant fields) → vector.env
  env-silo.ts                                 — pure: naming, subnets, paths per env
  hostname-resolver.ts                        — pure: (domain, envName) → hostname

adapters/
  targets/
    hetzner-vps.target.ts                     — implements DeployTarget, orchestrates hetzner/*
    cloudflare-pages.target.ts                — extraction of existing CF logic
  hetzner/
    hcloud-client.ts                          — typed fetch() to Hetzner Cloud API
    hcloud-state.ts                           — R2 state read/write with ETag locking
    ssh-session.ts                            — ssh2 wrapper, ONE connection per deploy
    remote-docker-compose.ts                  — compose ops via ssh
    caddy-admin-client.ts                     — POST to Caddy /load via ssh
    vl-log-verifier.ts                        — poll VictoriaLogs
  r2/
    r2-client.ts                              — S3 SDK wrapper for state + certs
```

## 4. `DeployTarget` interface

```typescript
interface DeployTarget {
  readonly name: string
  ensureInfra(projectName: string): Promise<void>
  deploy(config: ProjectDeployConfig): Promise<DeployResult>
  describe(projectName: string): Promise<TargetState | null>
  teardown(projectName: string): Promise<void>
}
```

Zero SSH/Docker/hcloud/Caddy leak in public types. If a method mentions a provider primitive, it's a design bug.

## 5. Cold path — `ensureInfra(project)`

1. Read state from R2 (`r2://nextnode-state/hetzner/<project>.json`)
2. If no VPS: `hcloud server create` with cloud-init user-data (bootstrap only)
3. Wait for server `running` + tailnet reachable (poll, timeout 120s)
4. Write state to R2 with ETag locking
5. Run convergence script (SSH, idempotent):
   - Caddy systemd running, admin API on 127.0.0.1:2019, `caddy-storage-s3` pointing to R2
   - Vector systemd running, env rendered with tenant fields
   - `/opt/apps/<project>/` exists, owned by `deploy`

## 6. Hot path — `deploy(config)`

1. Load state, resolve VPS. Fail if not provisioned.
2. Open ONE ssh session (ssh2 Client). Closed in `finally`.
3. Per env:
   - Compute silo (compose project name, paths, subnet) via `env-silo.ts`
   - Resolve hostname via `hostname-resolver.ts` (pure: `dev` + `acme.example.com` → `dev.acme.example.com`)
   - Compute env vars: CI secrets + auto-generated (SITE_URL from hostname, POSTGRES_PASSWORD, etc.) via `compose-env-resolver`
   - SSH: mkdir, write compose.yml + .env, docker login ghcr, docker compose pull, up -d
   - Wait for Docker healthcheck (timeout 90s default)
   - Read back assigned host ports via `docker compose port`
4. Build full Caddy JSON via `caddy-routes-builder` (pure)
5. POST to Caddy /load via SSH. Atomic: reject = old config stays.
6. HTTPS probe on each hostname (end-to-end verification)
7. VL log verify per (project, env) — at least 1 log within 90s
8. Close SSH, return DeployResult.

Target: 30-90s for most hot deploys.

## 7. Security — firewall

Hetzner firewall rules applied at provision time via hcloud API:

| Rule | Direction | Port | Source | Purpose |
|---|---|---|---|---|
| SSH | inbound | 22 | any (Tailscale handles auth) | Deploy + ops access |
| HTTP | inbound | 80 | any | Caddy redirect → HTTPS |
| HTTPS | inbound | 443 | any | Caddy serves web traffic |
| VictoriaLogs | inbound | 9428 | Tailscale only (ACL) | Vector → VL (already in tailnet ACLs from step 3a) |
| All other | inbound | * | — | **BLOCKED** |

- SSH access is via Tailscale-only in practice (UFW on the host restricts port 22 to tailscale0 interface). Hetzner firewall allows 22 as a fallback but the host-level firewall narrows it.
- Port 9428 is restricted at the Tailscale ACL level (`tag:client-vps → tag:monitoring`), not at the Hetzner firewall.
- No other inbound ports. Ever. Any new service that needs external access goes through Caddy reverse proxy on 443.

Firewall rules are declared in code (in `hcloud-client.ts`), not clicked in the console. `hetzner-provision` applies them idempotently.

## 8. SSH — single connection rule

One `ssh2` Client per deploy. All commands + file transfers through it. Never `child_process.exec('ssh ...')`.

Integration test: assert a full deploy opens exactly 1 SSH connection.

## 9. Env isolation — app-layer silos

Per `(project, env)`, computed by pure `env-silo.ts`:

| Property | Formula | Example |
|---|---|---|
| Compose project | `<project>-<env>` | `acme-web-dev` |
| Network | `<project>-<env>_default` | `acme-web-dev_default` |
| Subnet | `10.<hash(project)>.<env_index * 16>.0/24` | `10.47.0.0/24` |
| Base path | `/opt/apps/<project>/<env>/` | `/opt/apps/acme-web/dev/` |
| Volume prefix | `<project>-<env>_` | `acme-web-dev_postgres-data` |
| R2 cert path | `r2://nextnode-certs/<project>/<env>/` | — |
| Vector tag | `environment=<env>` | `environment=dev` |

Docker DNS never crosses envs — separate bridge networks, separate subnets, no route.

## 10. Caddy

- Native binary on VPS (systemd), not Docker.
- Admin API on `127.0.0.1:2019`, accessible only via SSH.
- Cert storage: `caddy-storage-s3` plugin → R2, path segregated by project + env.
- One POST `/load` per deploy with full config (all envs). Atomic.
- Upstreams: `127.0.0.1:<port>` where port = Docker-assigned, read via `docker compose port`.

## 11. R2 layout

```
r2://nextnode-state/hetzner/<project>.json     — server id, IP, tailnet hostname, last 5 deploys per env
r2://nextnode-certs/<project>/<env>/...        — Caddy certmagic storage
```

Locking: conditional put (If-Match ETag), retry 3x, then fail loud.

## 12. cloud-init split

**Bootstrap** (user-data, immutable after first boot, ~80 lines):
- Install: docker-ce, docker-compose-plugin, tailscale, caddy + caddy-storage-s3
- `tailscale up` with one-shot key + `tag:client-vps`
- Create `deploy` user + SSH key
- Install Vector binary + systemd unit
- Create `/opt/apps/`

**Convergence** (SSH script, idempotent, re-runnable):
- Push vector.toml + vector.env, restart if changed
- Push Caddy base config with R2 storage
- Ensure project directories

## 13. Vector

- Host-level agent, installed in bootstrap, configured in convergence.
- Sources: `docker_logs` + `journald`.
- Remap transform extracts env from container name prefix (`<project>-<env>-*`).
- HTTP sink to VictoriaLogs over tailnet. No secrets.

## 14. CI workflow

1. Existing `plan` job reads `nextnode.toml`, outputs `target`.
2. Route workflows dispatch by target:
   - `cloudflare-pages` → existing CF deploy
   - `hetzner-vps` → new Hetzner job
3. Hetzner job: build+push GHCR → join tailnet → `hetzner-provision` → `hetzner-deploy`
4. Zero shell logic in YAML — env var setup + node calls only.

## 15. Error handling

Every adapter wraps errors with context (host, step, project). No silent swallow, no fallback.

- SSH fail → log ssh stderr, exit non-zero
- docker compose up fail → fetch last 50 lines of logs, include in error
- Healthcheck timeout → fetch logs, fail, **leave container running** for debug
- Caddy POST fail → old config stays, propagate error body
- VL verify timeout → fail, leave containers running
- R2 ETag mismatch x3 → "state lock contention, another deploy in progress?"

## 16. Implementation order

| # | Checkpoint | Content |
|---|---|---|
| 1 | Config schema | Extend `config/schema.ts` with deploy target + hetzner |
| 2 | DeployTarget interface | `domain/deploy-target.ts` + contract tests |
| 3 | CF Pages target | Extract existing logic into `cloudflare-pages.target.ts` |
| 4 | Domain helpers | env-silo, hostname-resolver, compose-env-resolver, caddy-routes-builder, vector-env-renderer |
| 5 | hcloud-client + state | Hetzner API wrapper + R2 state with ETag |
| 6 | ssh-session | ssh2 wrapper, integration test with openssh-server container |
| 7 | remote-docker-compose | compose ops via ssh session |
| 8 | caddy-admin-client | POST /load via ssh |
| 9 | vl-log-verifier | Poll VL endpoint |
| 10 | HetznerVpsTarget | Wire adapters, implement DeployTarget |
| 11 | cloud-init | Bootstrap + convergence scripts |
| 12 | CLI commands | provision, deploy, describe, teardown |
| 13 | CI workflow | Route by target in existing pipeline |
| 14 | CLAUDE.md update | Document DeployTarget pattern |

## 17. Out of scope v1

- Preview environments
- Multi-project per VPS
- Auto-rollback
- Manual rollback (hetzner-rollback command)
- DB backups
- Secret rotation
- Rate limiting / DDoS at Caddy
- SSH key rotation
- Subdomain management
- Sablier / idle sleeping (killed)
- Blue-green (killed)
- Caddyfile text mutation (killed)
- AST compose transforms (killed)

## 18. Definition of done

1. `nextnode.toml` with `target = "hetzner-vps"` + `project.domain` → CI provisions + deploys dev + prod
2. Re-push → hot path <90s
3. Dev and prod are fully siloed (separate networks, volumes, containers)
4. Logs visible in VL with correct env tags
5. Firewall: only 22/80/443 open, verified via `hcloud firewall describe`
6. All checks green: test, lint, format, type-check, build
