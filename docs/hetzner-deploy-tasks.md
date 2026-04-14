# Hetzner Deploy v1 — Tasks

Atomic implementation steps for [hetzner-deploy-plan.md](./hetzner-deploy-plan.md). Each task is independently testable.

## 1 — Config schema ✅

### 1.1 Add deploy target types to config/schema.ts

Done. `DeployTarget`, `HetznerDeployConfig`, `HetznerVpsDeploySection` in `config/types.ts`.

### 1.2 Add validation for [deploy.target] and [deploy.hetzner]

Done. Multi-error validation in `config/validation/providers/hetzner.ts` + `config/validation/deploy.ts`.

## 2 — DeployTarget interface ✅

### 2.1 Create DeployTarget interface and core types

Done. `domain/deploy/target.ts` — `DeployTarget`, `ImageRef`, `ContainerDeployConfig`, `StaticDeployConfig`, `DeployResult`, `TargetState`.

### 2.2 Create InMemoryDeployTarget + contract tests

Done. `domain/deploy/target.test.ts`.

## 3 — CF Pages target extraction ✅

### 3.1 Extract cloudflare-pages.target.ts from existing commands

Done. `adapters/cloudflare/target.ts` — `CloudflarePagesTarget` implements `DeployTarget<StaticDeployConfig>`. Wired in `cli/deploy/create-target.ts`.

## 4 — Domain helpers ✅

### 4.1 hostname-resolver — skipped

`resolveDeployDomain` in `domain/deploy/domain.ts` already covers this. No separate file needed.

### 4.2 env-silo

Done. Types in `domain/env-silo.ts`, logic in `domain/compute-silo.ts`. Returns `{ id }` only — additional fields (subnet, paths, volumes) will be added as adapters that consume them are built.

### 4.3 compose-env-resolver

Done. Types in `domain/compose-env.ts`, logic in `domain/resolve-compose-env.ts`. Auto-generates SITE_URL, COMPOSE_PROJECT_NAME, NN_ENVIRONMENT, merges CI secrets on top.

### 4.4 caddy-routes-builder

Done. Types in `domain/caddy-config.ts`, logic in `domain/build-caddy-config.ts`. Full Caddy JSON config with routes per hostname → reverse_proxy, TLS automation via caddy-storage-s3 → R2. HTTP→HTTPS redirect handled automatically by Caddy when host matcher is present.

### 4.5 vector-env-renderer

Done. Types in `domain/vector-env.ts`, logic in `domain/render-vector-env.ts`.

## 5 — Hetzner adapters (hcloud + R2) ✅

### 5.1 hcloud-client

Done. `adapters/hetzner/hcloud-client.ts` — `createServer`, `describeServer`, `deleteServer`, `createFirewall`, `applyFirewall`. Types split: `hcloud-server.ts`, `hcloud-firewall.ts`, `hcloud-api.ts`. Uses `isRecord` from `config/types.ts`.

### 5.2 hcloud-state

Done. `adapters/hetzner/hcloud-state.ts` — `readState`, `writeState` (3x retry on ETag contention), `deleteState`. Depends on `R2Operations` interface. Types in `hcloud-state.types.ts`.

### 5.3 r2-client

Done. `adapters/r2/r2-client.ts` — `R2Client` class wrapping `@aws-sdk/client-s3`. Types + `R2Operations` interface in `r2-client.types.ts`. S3Client injectable for testing.

## 6 — SSH session

### 6.1 Create ssh-session.ts

Create `adapters/hetzner/ssh-session.ts`:
- Wrapper around `ssh2` Client
- `createSshSession(host, keyPath, user?)` → `SshSession`
- Methods: `exec(cmd)`, `writeFile(path, content)`, `readFile(path)`, `close()`
- Single connection reused

**Test:** unit tests with mocked ssh2 Client. Covers: exec returns stdout, writeFile+readFile, failing command returns stderr, close disposes connection.

## 7 — cloud-init

### 7.1 Write cloud-init bootstrap template

~80 lines: docker-ce, tailscale, caddy+s3-plugin, vector, deploy user, UFW (22/80/443), `/opt/apps/`.

**Test:** YAML lint passes. Template renders with test variables.

### 7.2 Write convergence script (idempotent SSH)

Push vector.toml + vector.env, push Caddy base config, ensure project dirs. Skip if unchanged.

**Test:** Run twice — second run is no-op (no restarts).

## 8 — HetznerVpsTarget.ensureInfra

### 8.1 Implement ensureInfra

Wire adapters: read state → create VPS if missing → firewall (22/80/443) → wait for server running → wait SSH reachable → write state.

**Test:** covers: first call creates, second call skips (idempotent), failure propagates.

### 8.2 Provision CLI command

`cli/hetzner/provision.command.ts` — reads env vars + config → `target.ensureInfra()` → logs success. Register as `hetzner-provision`.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- provision.command`

## 9 — HetznerVpsTarget.deploy (deferred)

### 9.1 Remote Docker Compose adapter

`adapters/hetzner/remote-docker-compose.ts` — compose ops via SshSession: `pull`, `up`, `down`, `getPort`, `getLogs`, `waitHealthy`.

### 9.2 Caddy admin client adapter

`adapters/hetzner/caddy-admin-client.ts` — POST /load via SshSession.

### 9.3 VL log verifier adapter

`adapters/hetzner/vl-log-verifier.ts` — poll VictoriaLogs `/select/logsql/query`.

### 9.4 Implement HetznerVpsTarget.deploy

Wire adapters: load state → 1 SSH session → per env (silo + hostname + env vars + compose pull/up + healthcheck + ports) → Caddy POST → HTTPS probe → VL verify → update state.

### 9.5 Deploy CLI command

`cli/hetzner/deploy.command.ts` — reads env vars + config + image ref + secrets → `target.deploy()`.

## 10 — HetznerVpsTarget.describe + teardown (deferred)

- `describe`: read state + SSH docker compose ps → TargetState
- `teardown`: compose down + hcloud delete + remove state
- CLI commands: `hetzner-describe`, `hetzner-teardown`

## 11 — CI workflow (deferred)

- `plan` command outputs `deploy_target` from nextnode.toml
- Route workflows: `cloudflare-pages` → existing, `hetzner-vps` → new job (build+push GHCR → join tailnet → provision → deploy)

## 12 — Documentation

Update `packages/infrastructure/CLAUDE.md` with DeployTarget pattern, Hetzner adapter architecture, layer rules for target orchestrators.

## 13 — Final check

```
pnpm --filter @nextnode-solutions/infrastructure test
pnpm --filter @nextnode-solutions/infrastructure run lint
pnpm --filter @nextnode-solutions/infrastructure run format:check
pnpm --filter @nextnode-solutions/infrastructure run type-check
pnpm --filter @nextnode-solutions/infrastructure run build
```

All 5 return exit code 0.
