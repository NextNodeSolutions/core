# Spec — Multi-service Docker deploy (Hetzner VPS)

**Status**: Draft
**Owner**: infra
**Supersedes**: current single-service `renderComposeFile` in `src/domain/hetzner/compose-file.ts`

> **Terminology**: throughout this spec, "volume" always means a **Docker named
> volume** (managed by the Docker daemon on the VPS local SSD). Hetzner Block
> Volumes are **not** used by default — see `docs/infra-topology.md` for the
> rationale and the escape-hatch criteria.

---

## 1. Goal

Allow a NextNode project to deploy a **multi-container stack** (e.g. a monitoring
app with `grafana` + `alertmanager` + `prometheus` + `victorialogs`) on a Hetzner
VPS, while keeping:

- **Single source of truth per concept** (no duplication between `compose.yaml`
  and `nextnode.toml`).
- **One global Caddy** per VPS (shared across all projects), unchanged
  architecture (systemd binary on host).
- **Zero host-port allocation** (no collision across projects, infinite scale).
- **Per-service public routing** (each exposed service gets its own hostname and
  TLS cert).

## 2. Non-goals

- Replacing Caddy with Traefik or any other proxy.
- Running Caddy in a container.
- Supporting > 1 replica per service in v1 (single-replica only).
- Kubernetes / Nomad / Docker Swarm. We stay on standalone Docker + compose.
- Multi-VPS orchestration (a project = one VPS).

## 3. Architecture at a glance

```
┌─── APP REPO ────────────────┐        ┌─── INFRA (this package) ──────────┐
│                             │        │                                    │
│  compose.yaml               │        │  Generates on VPS:                 │
│   - services + labels       │───────►│   .env                             │
│   - volumes, depends_on     │        │   compose.deploy.yaml (overlay)    │
│                             │        │     (env_file, restart only —      │
│  nextnode.toml              │        │      NEVER "ports:")               │
│   - project.domain (base)   │        │                                    │
│   - deploy.env / secrets    │        │  Updates /etc/caddy/config.json    │
└─────────────────────────────┘        │   (upstreams dial container IPs)   │
                                       └────────────────────────────────────┘
```

Docker performs the compose merge natively via
`docker compose -f compose.yaml -f compose.deploy.yaml up -d`. Infra does not
re-implement YAML merging.

## 4. Source-of-truth matrix

| Concept                              | Owned by              | Notes                                                         |
| ------------------------------------ | --------------------- | ------------------------------------------------------------- |
| Services, images, volumes            | `compose.yaml`        | App-repo topology, portable, runnable locally                 |
| `depends_on`, healthchecks, networks | `compose.yaml`        | App-repo implementation detail                                |
| Which service is public              | `compose.yaml` labels | Lives next to the service definition                          |
| Public subdomain per service         | `compose.yaml` labels | Idem                                                          |
| Container listen port                | **auto-detected**     | Read from `image.Config.ExposedPorts`; label is override only |
| Host ports                           | **none**              | Alt A: Caddy dials container IPs                              |
| Project base domain                  | `nextnode.toml`       | DNS zone                                                      |
| Env / secrets                        | `nextnode.toml`       | Deploy-environment concern                                    |
| Silo / compose project name          | Infra (computed)      | `computeSilo(project, env)` — unchanged                       |
| DNS records, TLS, Caddy routes       | Infra                 | Unchanged ownership                                           |

## 5. Expose labels — public contract

```yaml
services:
    grafana:
        image: grafana/grafana
        labels:
            nextnode.expose: 'true'
            nextnode.expose.subdomain: 'grafana' # optional
            nextnode.expose.port: '3000' # optional escape hatch
```

| Label                       | Required     | Default                                  | Purpose                                  |
| --------------------------- | ------------ | ---------------------------------------- | ---------------------------------------- |
| `nextnode.expose`           | ✅ if public | —                                        | Opt-in to public routing                 |
| `nextnode.expose.subdomain` | ❌           | (bare domain claim)                      | Hostname prefix                          |
| `nextnode.expose.port`      | ❌           | auto-detected via `docker image inspect` | Override if image declares 0 or ≥2 ports |

### 5.1 Hostname resolution

Base domain comes from `nextnode.toml`'s `project.domain`. The exposed service's
subdomain label is prepended. The dev prefix is inserted **between** subdomain
and base domain.

```
Given: project.domain = "monitoring.nextnode.fr"

Label                               Prod hostname                        Dev hostname
──────────────────────────────      ──────────────────────────────       ──────────────────────────────────────
(no subdomain)                      monitoring.nextnode.fr               dev.monitoring.nextnode.fr
subdomain: "grafana"                grafana.monitoring.nextnode.fr       grafana.dev.monitoring.nextnode.fr
subdomain: "alerts"                 alerts.monitoring.nextnode.fr        alerts.dev.monitoring.nextnode.fr
(no expose label)                   — internal, no DNS —                 — internal, no DNS —
```

Rationale for `grafana.dev.<base>` over `dev.grafana.<base>`:

- **Wildcard cert**: one `*.dev.monitoring.nextnode.fr` covers the full dev zone.
- **DNS hygiene**: dev is a sub-zone, not a leaf above each service.
- **Semantic clarity**: "grafana in the dev env of monitoring".

### 5.2 Validation rules (domain layer, fail loud)

| Case                                            | Behavior                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 0 exposed services                              | OK — internal-only project (worker, cron). No DNS, no Caddy.                                       |
| 1 exposed, no `subdomain`                       | Claims bare `domain`. ✅                                                                           |
| N exposed, ≤1 omits `subdomain`                 | That one wins bare; others prefixed. ✅                                                            |
| N exposed, ≥2 omit `subdomain`                  | ❌ Error: `services "x" and "y" both claim the bare domain; add nextnode.expose.subdomain to one.` |
| Image declares 0 ports, no `expose.port` label  | ❌ Error: `image "x" declares no EXPOSE ports, add nextnode.expose.port`                           |
| Image declares ≥2 ports, no `expose.port` label | ❌ Error: `image "x" exposes multiple ports (3000, 8443), specify nextnode.expose.port`            |
| Unknown `nextnode.*` label key                  | ⚠️ Warn (e.g. typo `nextnode.exposse`)                                                             |
| Service scaled > 1 (replicas)                   | ❌ Error: v1 supports 1 replica per exposed service                                                |

## 6. Port resolution (Alt A — dial container IPs)

Caddy stays on the host (systemd, unchanged). No host-port binding. Infra reads
the container's bridge IP after deploy and writes it into Caddy's upstream
config.

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Hetzner VPS                                   │
│                                                                       │
│  systemd                                                              │
│   ├── caddy.service                                                   │
│   └── vector.service                                                  │
│                                                                       │
│  :80/:443 ▼                                                           │
│  ┌──────────────────────────────────────┐                             │
│  │ Caddy     /etc/caddy/config.json :   │                             │
│  │  grafana.monitoring.fr               │                             │
│  │    → dial 172.22.0.5:3000    ────────┼──┐                          │
│  │  alerts.monitoring.fr                │  │                          │
│  │    → dial 172.22.0.6:9093    ────────┼──┼─┐                        │
│  └──────────────────────────────────────┘  │ │                        │
│                                            ▼ ▼                        │
│  Docker  ┌── bridge: monitoring-prod_default (172.22.0.0/16) ───┐     │
│          │                                                      │     │
│          │  grafana       alertmanager     prometheus           │     │
│          │  172.22.0.5    172.22.0.6       172.22.0.7           │     │
│          │  :3000         :9093            :9090                │     │
│          │  (public)      (public)         (internal)           │     │
│          └──────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

### 6.1 `CaddyUpstream` shape

```ts
export interface CaddyUpstream {
	readonly hostname: string // "grafana.monitoring.nextnode.fr"
	readonly dial: string // "172.22.0.5:3000"  (was "localhost:8080")
}
```

The type signature doesn't change; only the value source does.

### 6.2 Inspection command

Per exposed service, after `docker compose up -d --wait`:

```bash
docker inspect <silo>-<service>-1 \
  --format '{{(index .NetworkSettings.Networks "<silo>_default").IPAddress}}'
```

## 7. Deploy sequence

```
infra CLI                        VPS (ssh)                         Caddy (systemd)
   │                                │                                       │
   │ 1. parse toml + compose.yaml   │                                       │
   │    validate expose.* labels    │                                       │
   │                                │                                       │
   │ 2. scp compose.yaml ──────────►│                                       │
   │                                │                                       │
   │ 3. docker login ──────────────►│                                       │
   │ 4. docker compose pull ───────►│                                       │
   │                                │                                       │
   │ 5. docker image inspect ──────►│  auto-detect EXPOSE ports             │
   │                                │                                       │
   │ 6. render compose.deploy.yaml  │                                       │
   │    (env_file + restart; no "ports:")                                   │
   │                                │                                       │
   │ 7. scp overlay + .env ────────►│                                       │
   │ 8. docker compose up -d --wait ►  containers healthy                   │
   │                                │                                       │
   │ 9. docker inspect <ctr> ──────►│  extract bridge IP                    │
   │                                │                                       │
   │10. load existing config.json   │                                       │
   │11. merge: replace silo routes, │                                       │
   │    preserve other projects     │                                       │
   │12. caddy validate ────────────►│  reject if malformed                  │
   │13. write config.json + backup  │                                       │
   │14. systemctl reload caddy ────►│ ──────────────────────────────────────►│ reload
   │15. curl https://<hostname>/ ──►│                                       │ serves
   │    rollback on repeated 502    │                                       │
```

## 8. Code changes

### 8.1 New files

| Path                                           | Layer   | Responsibility                                                                           |
| ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `src/domain/hetzner/compose-labels.ts`         | domain  | Parse `nextnode.expose.*` from a compose.yaml tree                                       |
| `src/domain/hetzner/expose-plan.ts`            | domain  | `ExposePlan = Array<{ service, subdomain, containerPort, hostname }>` + validation rules |
| `src/domain/hetzner/compose-deploy-overlay.ts` | domain  | Render overlay YAML (env_file + restart, NO ports)                                       |
| `src/domain/hetzner/caddy-config-merge.ts`     | domain  | Merge N new routes for a silo into existing config.json, preserving other silos' routes  |
| `src/adapters/hetzner/image-inspect.ts`        | adapter | `inspectExposedPort(session, imageRef)` via `docker image inspect .Config.ExposedPorts`  |
| `src/adapters/hetzner/container-ip.ts`         | adapter | `inspectContainerIp(session, containerName, networkName)` with retry-until-healthy       |
| `src/adapters/hetzner/caddy-reload.ts`         | adapter | validate → backup → write → reload → healthcheck → rollback on failure                   |

### 8.2 Modified files

| Path                                       | Change                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `src/adapters/hetzner/deploy-container.ts` | Pull → inspect image ports → render overlay → up → inspect IPs → update Caddy |
| `src/domain/hetzner/caddy-config.ts`       | `CaddyUpstream.dial` doc update (IP:port, not localhost:port)                 |
| `src/domain/cloudflare/dns-records.ts`     | Support N records per project (one per exposed hostname)                      |
| `src/adapters/cloudflare/pages-dns.ts`     | Iterate over N records                                                        |
| `src/adapters/hetzner/teardown-project.ts` | Remove Caddy routes **before** `docker compose down`                          |
| `src/domain/hetzner/cloud-init.ts`         | Add `/etc/docker/daemon.json` with enlarged `default-address-pools`           |
| `src/domain/hetzner/systemd-units.ts`      | Add `After=docker.service` + `Requires=docker.service` to Caddy unit          |
| `src/config/schema.ts`                     | (no change to `project.domain`; may add optional `[deploy]` block later)      |

### 8.3 Deleted files

| Path                                      | Reason                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `src/domain/hetzner/compose-file.ts`      | Replaced by `compose-deploy-overlay.ts` — no more full compose generation |
| `src/domain/hetzner/compose-file.test.ts` | Tests move to the new overlay module                                      |

All port allocation code (`CONTAINER_PORT`, `HOST_PORT_BASE`, `ENV_PORT_OFFSET`,
`computeHostPort`) is removed.

### 8.4 New systemd unit

`caddy-boot-reconcile.service` — runs once at boot, after `docker.service`:

- Reads the list of known deployed projects (from `/var/lib/nextnode/projects.json` or from R2 state).
- Waits for their containers to be healthy.
- Re-inspects IPs, rewrites `config.json` if divergence.
- Reloads Caddy.

Prevents stale IPs after a VPS reboot.

## 9. Edge cases

Full analysis lives in §10 below. Summary of critical mitigations already baked
into the design:

- **E1 — IP changes after `up -d`**: infra reads IP **after** `up -d --wait`, before Caddy reload.
- **E2 — Caddy starts before Docker at boot**: `After=docker.service` + `caddy-boot-reconcile.service`.
- **E3 — healthy != ready**: mandatory `healthcheck` in `compose.yaml` for exposed services (enforced at parse time).
- **E4 — concurrent deploys**: lock per project in R2 state (ETag, same pattern as `hcloud-state`).
- **E5 — subnet exhaustion**: enlarged `default-address-pools` in daemon.json.
- **E9 — malformed Caddy config**: `caddy validate` + rollback on reload failure.

## 10. Edge case catalogue

### Critical (must fix before merge)

| ID  | Scenario                                | Mitigation                                                                      |
| --- | --------------------------------------- | ------------------------------------------------------------------------------- |
| E1  | Container IP changes after `up -d`      | Order: `up --wait` → `inspect` → `caddy reload`. Skip reload if IPs match.      |
| E2  | Caddy starts before Docker at boot      | `After=docker.service` + `Requires=docker.service` + boot-reconcile service     |
| E3  | Container healthy but service not ready | Enforce `healthcheck` in compose for exposed services; post-reload `curl` probe |
| E4  | Concurrent deploys on same project      | ETag lock in R2 state per project                                               |

### Important

| ID  | Scenario                               | Mitigation                                                               |
| --- | -------------------------------------- | ------------------------------------------------------------------------ |
| E5  | Subnet collision > 30 projects         | `default-address-pools`: `172.17.0.0/12` with `size: 24` (4096 nets)     |
| E6  | Teardown leaves dangling Caddy entries | Remove routes **before** `docker compose down`; weekly reconcile cron    |
| E7  | Label typos silently ignored           | Warn on unknown `nextnode.*`; fail on unknown `nextnode.expose.*` suffix |
| E8  | Service scaled > 1 (replicas)          | Fail loud at parse; v1 = 1 replica per exposed service                   |
| E9  | Malformed Caddy config crashes reload  | `caddy validate` before write; `config.json.bak` rollback                |

### Minor (acceptable in v1)

| ID  | Scenario                                  | Mitigation                                                                        |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| E10 | IP changes on Docker daemon restart       | Covered by boot-reconcile service (E2)                                            |
| E11 | In-flight requests during Caddy reload    | Accept — Caddy reload is atomic for new conns; in-flight finish with old upstream |
| E12 | Container exposes 0 or ≥2 ports ambiguous | Covered by `image-inspect.ts` fail-loud rules                                     |
| E13 | Service on multiple networks (custom+ext) | Always pick `<silo>_default`; fail loud if missing                                |

## 11. Rollout plan

### Phase 1 — Foundation (invisible to apps)

Changes to infra-level scaffolding, can ship independently:

1. `cloud-init.ts`: add `default-address-pools` in daemon.json.
2. `systemd-units.ts`: add `After=docker.service` + `Requires=docker.service` on Caddy.
3. Write `caddy-boot-reconcile.service` + script in cloud-init and packer/setup.sh.
4. Deploy a fresh test VPS to validate boot ordering.

Criteria for done: reboot a VPS, all existing projects resume serving without manual intervention.

### Phase 2 — Multi-service deploy (user-visible feature)

1. `domain/hetzner/compose-labels.ts` + tests.
2. `domain/hetzner/expose-plan.ts` + tests (hostname resolution, validation rules).
3. `domain/hetzner/compose-deploy-overlay.ts` + tests (replaces `compose-file.ts`).
4. `domain/hetzner/caddy-config-merge.ts` + tests (preserves other silos' routes).
5. `adapters/hetzner/image-inspect.ts` + tests (stubbed SSH).
6. `adapters/hetzner/container-ip.ts` + tests (stubbed SSH, retry-until-healthy).
7. `adapters/hetzner/caddy-reload.ts` + tests (validate + rollback).
8. Rewire `deploy-container.ts` to orchestrate the new flow.
9. Update `dns-records.ts` + `pages-dns.ts` for N records per project.
10. Update `teardown-project.ts` to purge Caddy routes first.
11. End-to-end test on a fresh VPS with the monitoring stack as fixture.

Criteria for done: monitoring stack (grafana + alertmanager + prometheus + victorialogs) deploys to a fresh VPS via CI, all four services reachable at their subdomains with valid certs, internal services unreachable from outside.

### Phase 3 — Adoption

1. Reference repo: `nextnode-monitoring` with `compose.yaml` + `nextnode.toml` as a worked example.
2. Migration guide for existing apps: single-service stays one-liner (`nextnode.expose: "true"` on the single service, no subdomain), no breaking change.
3. Migration script for existing VPS: purge old host-port bindings from Caddy config, re-deploy each project to switch to IP-dial.

## 12. Invariants (checked in tests)

1. No compose generated by infra ever contains a `ports:` section with a host port.
2. No duplication between `compose.yaml` (services) and `nextnode.toml` (deploy).
3. `domain/` modules have zero IO (no `fs`, `fetch`, `process.env`, no SSH sessions).
4. `adapters/` modules never make business decisions (no fallback values, no policy).
5. Fail-loud on every ambiguous input (ports, subdomains, replicas, unknown labels).
6. `teardown-project.ts` removes Caddy routes **before** stopping containers.
7. Caddy reload never happens without a prior `caddy validate` success.

## 13. Worked example: monitoring stack

### `compose.yaml` (app repo)

```yaml
services:
    grafana:
        image: grafana/grafana:latest
        depends_on: [victorialogs, prometheus]
        healthcheck:
            test:
                [
                    'CMD',
                    'wget',
                    '-q',
                    '--spider',
                    'http://localhost:3000/api/health',
                ]
            interval: 10s
            retries: 5
        labels:
            nextnode.expose: 'true'
            nextnode.expose.subdomain: 'grafana'

    alertmanager:
        image: prom/alertmanager:latest
        healthcheck:
            test:
                [
                    'CMD',
                    'wget',
                    '-q',
                    '--spider',
                    'http://localhost:9093/-/ready',
                ]
        labels:
            nextnode.expose: 'true'
            nextnode.expose.subdomain: 'alerts'

    prometheus:
        image: prom/prometheus:latest
        volumes: ['prometheus-data:/prometheus']

    victorialogs:
        image: victoriametrics/victoria-logs:latest
        volumes: ['vl-data:/victoria-logs-data']

volumes:
    prometheus-data:
    vl-data:
```

### `nextnode.toml` (app repo)

```toml
[project]
name   = "monitoring"
domain = "monitoring.nextnode.fr"
type   = "app"

[deploy]
target = "hetzner"

[deploy.env]
LOG_LEVEL = "info"
```

### Result in production

| Hostname                         | Container                        | Container IP | Container port |
| -------------------------------- | -------------------------------- | ------------ | -------------- |
| `grafana.monitoring.nextnode.fr` | `monitoring-prod-grafana-1`      | 172.22.0.5   | 3000           |
| `alerts.monitoring.nextnode.fr`  | `monitoring-prod-alertmanager-1` | 172.22.0.6   | 9093           |
| — (internal)                     | `monitoring-prod-prometheus-1`   | 172.22.0.7   | 9090           |
| — (internal)                     | `monitoring-prod-victorialogs-1` | 172.22.0.8   | 9428           |

Grafana talks to Prometheus via the compose network using the service name:
`http://prometheus:9090`. No public exposure.

### Result in development

Same stack under `grafana.dev.monitoring.nextnode.fr` and
`alerts.dev.monitoring.nextnode.fr`. Internal services keep their compose DNS
names (`prometheus`, `victorialogs`), isolated in the dev silo's bridge network.

## 14. Open questions

- Should `project.domain` become optional in `nextnode.toml` for internal-only
  projects (zero exposed services)? Currently required. Soft decision: keep
  required to avoid ambiguity; internal-only projects can still declare a domain
  even if unused (useful if they ever get exposed later).
- Caddy healthcheck post-reload: should rollback be automatic, or surface the
  failure to CI and let the pipeline decide? Current plan: auto-rollback on
  repeated 502s within 30s window, surface a CI warning.
- Do we want to expose the `ExposePlan` in the `plan` command's output so users
  see at plan-time what hostnames they'll get? Nice-to-have, not blocking.
