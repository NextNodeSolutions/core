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

## 6 — SSH session ✅

### 6.1 Create ssh-session.ts

Done. `adapters/hetzner/ssh-session.ts` — `createSshSession({ host, username, privateKey })` → `SshSession`. Methods: `exec(cmd)`, `writeFile(path, content)`, `readFile(path)`, `close()`. Types in `ssh-session.types.ts`, tests in `ssh-session.test.ts`.

## 7 — cloud-init ✅

### 7.1 Write cloud-init bootstrap template

Done. `domain/hetzner/cloud-init.ts` (types) + `domain/hetzner/render-cloud-init.ts` (pure renderer). Builds cloud-init as structured object, serializes via `yaml` lib. Installs docker-ce, tailscale, caddy+certmagic-s3, vector, deploy user, UFW (80/443 + SSH on tailscale0 only).

### 7.2 Write convergence script (idempotent SSH)

Done. `domain/hetzner/render-vector-toml.ts` (Vector config renderer) + `cli/hetzner/converge.ts` (convergence orchestrator). Pushes vector.toml, vector.env, caddy base config via SSH. Restarts services only on change. Creates project dirs.

## 8 — HetznerVpsTarget.ensureInfra ✅

### 8.1 Implement ensureInfra

Done. `adapters/hetzner/target.ts` - `HetznerVpsTarget` implements `DeployTarget<ContainerDeployConfig>`. ensureInfra: read state -> create VPS + firewall if missing -> wait running -> wait SSH -> converge -> write state. Wired in `cli/deploy/create-target.ts`.

### 8.2 Provision CLI command

Already wired - `cli/deploy/provision.command.ts` calls `target.ensureInfra()` via `createTarget()` which now returns `HetznerVpsTarget` for `hetzner-vps` target.

### 8.3 Phase-based state + orphan-safe re-entrancy

**Problem.** Today `writeState` only runs at the end of `ensureInfra`. If provisioning crashes mid-flight (SSH timeout, converge fail, Caddy reload error), no state is written, and the next run re-enters `fresh provision` → creates a second VPS. Orphans accumulate silently and bill.

**Spec.**

- Extend `HcloudProjectState` with a discriminated `phase`:
    ```ts
    type Phase = 'created' | 'provisioned' | 'converged'
    HcloudProjectState { phase: Phase, serverId, publicIp, tailnetIp?, convergedAt? }
    ```
- `ensureInfra` writes state **at each transition**:
    1. after `createServer` → `phase='created'` (serverId + publicIp)
    2. after `getTailnetIpByHostname` → `phase='provisioned'` (+tailnetIp)
    3. after `runConvergence` → `phase='converged'` (+convergedAt)
- On re-run, branch on `existing.state.phase`:
    - `undefined` (no state) → preflight + create server + all steps
    - `'created'` → `describeServer` by id, resume at `waitForServerRunning` + firewall + converge + Tailscale lookup
    - `'provisioned'` → re-run convergence only (idempotent)
    - `'converged'` → converge as today (no-op if nothing changed)
- **Reality check before trusting state**: at entry, if `phase !== undefined`, call `describeServer(state.serverId)`. If 404, state is stale (server deleted out-of-band) → wipe state via `deleteState` and fall through to fresh provision. Fail loud, never auto-recreate silently.
- **Pre-create orphan check**: before `createServer`, `GET /servers?label_selector=project=<name>,managed_by=nextnode`. If a server exists with same labels, fail loud ("orphan detected, run teardown or delete manually") — never adopt automatically (matches `never auto-substitute` spirit).

**Files touched.**
- `adapters/hetzner/hcloud-state.types.ts` — add `phase` + optional fields
- `adapters/hetzner/hcloud-state.ts` — `parseState` validates per-phase shape
- `adapters/hetzner/hcloud-client.ts` — `findServersByLabels(token, labels)` adapter helper
- `adapters/hetzner/target.ts` — split `ensureInfra` into phase-specific branches, 3 `writeState` calls
- `adapters/hetzner/hcloud-state.test.ts` — cover each phase shape + invalid transitions
- `adapters/hetzner/target.test.ts` — tests for resume from `created` / `provisioned`, orphan detection, stale state recovery

**Non-goals.** No automatic rollback on failure (teardown stays separate in step 10). No state migration helper — bucket is internal, we can blow it away if schema changes before v1.

**Test:** run `ensureInfra`, kill process mid-convergence (simulate SSH drop), re-run → must reuse existing server, not create a second one. Validate phases in state JSON at each interruption point.

### 9.1 Remote Docker Compose ✅

Done. `adapters/hetzner/deploy-container.ts` — `deployContainer(session, input)`: writes `.env` + `compose.yaml`, registry login, `docker compose pull` + `up -d`, returns `CaddyUpstream` + `ContainerDeployedEnvironment`. Domain helpers: `compose-file.ts` (renderComposeFile, computeHostPort), `compose-env.ts` (formatComposeEnv).

### 9.2 Caddy reload ✅

Done. Inline in `HetznerVpsTarget.deploy()` (`adapters/hetzner/target.ts`): builds Caddy JSON config via `buildCaddyForProject`, writes to `CADDY_CONFIG_PATH`, runs `caddy reload`. Base config pushed during convergence (`converge-vps.ts`).

### 9.3 VL log verifier — deferred

Not implemented. VictoriaLogs query verification after deploy. Low priority — logs flow via Vector regardless; this would be a post-deploy assertion.

### 9.4 Implement HetznerVpsTarget.deploy ✅

Done. `adapters/hetzner/target.ts` — `deploy()`: read state → SSH session → `deployContainer` → build Caddy config with upstream → write + reload Caddy → return `DeployResult`.

### 9.5 Deploy CLI command ✅

Done. `cli/deploy/deploy.command.ts` — orchestrates env vars + config + image ref + secrets → `target.deploy()`. Hetzner target factory in `cli/deploy/create-hetzner-target.ts`.

## 10 — HetznerVpsTarget.describe + teardown

- `describe`: read state + SSH docker compose ps → TargetState
- `teardown`: compose down + hcloud delete server + hcloud delete firewall + **delete Tailscale device via `DELETE /api/v2/device/:id`** + remove R2 state.
    - **Why the Tailscale delete is mandatory:** devices are non-ephemeral by design (ephemeral carries a GC-on-transient-outage risk that would permanently lock the VPS out of the tailnet, with no backdoor since UFW closes public SSH). Without an explicit device delete at teardown, re-provisioning the same project name collides with the old entry and Tailscale appends `-1`/`-2` suffixes, producing the duplicate-device accumulation we already hit in E2E. Device id is resolved at teardown via `GET /tailnet/-/devices` filtered on `hostname` — no need to persist it in state.
- CLI commands: `hetzner-describe`, `hetzner-teardown`

## 11 — CI workflow

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
