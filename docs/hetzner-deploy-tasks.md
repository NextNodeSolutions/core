# Hetzner Deploy v1 — Tasks

Atomic implementation steps for [hetzner-deploy-plan.md](./hetzner-deploy-plan.md). Each task is independently testable.

## 1 — Config schema

### 1.1 Add deploy target types to config/schema.ts

Add `DeployTarget`, `HetznerDeployConfig`, and extended `DeploySection` types. Add `target` field (`"hetzner-vps" | "cloudflare-pages"`) and `hetzner` field (optional object with `server_type`, `location`).

**Test:** `pnpm --filter @nextnode-solutions/infrastructure type-check` passes.

### 1.2 Add validation for [deploy.target] and [deploy.hetzner]

In `parseConfig`, validate:
- `deploy.target` must be `"hetzner-vps"` or `"cloudflare-pages"` (default: infer from `project.type` — `"static"` → `"cloudflare-pages"`, `"app"` → `"hetzner-vps"`)
- If target is `"hetzner-vps"`: `deploy.hetzner` required with `server_type` (string) and `location` (string)
- If target is `"hetzner-vps"`: `project.domain` required (used for hostname convention)
- Collect all errors (multi-error, not fail-first)

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test` — new tests in `config/schema.test.ts` cover: valid hetzner config, missing hetzner block, missing domain, default target inference from type, invalid target string.

## 2 — DeployTarget interface

### 2.1 Create DeployTarget interface and core types

Create `domain/deploy-target.ts` with:
- `ImageRef` (registry, repository, tag)
- `EnvironmentDeployConfig` (name, hostname, envVars, secrets)
- `ProjectDeployConfig` (projectName, image, environments, composeFileContent)
- `DeployedEnvironment` (name, url, imageRef, deployedAt)
- `TargetState` (projectName, environments)
- `DeployResult` (projectName, deployedEnvironments, durationMs)
- `DeployTarget` interface (name, ensureInfra, deploy, describe, teardown)

Zero provider-specific types.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure type-check` passes. Exports usable from other domain files.

### 2.2 Create InMemoryDeployTarget + contract tests

Create `domain/deploy-target.test.ts` with:
- `InMemoryDeployTarget` implementing `DeployTarget` (stores state in Maps, no IO)
- Contract tests:
  - `ensureInfra` then `describe` returns state
  - `deploy` returns DeployResult with correct environments
  - `deploy` without `ensureInfra` throws
  - `teardown` then `describe` returns null
  - Double `ensureInfra` is idempotent

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- deploy-target` — all green.

## 3 — CF Pages target extraction

### 3.1 Extract cloudflare-pages.target.ts from existing commands

Refactor existing Cloudflare Pages logic into `adapters/targets/cloudflare-pages.target.ts` implementing `DeployTarget`.

- Map existing pages-project, pages-domains, sync-pages-env, deploy-env commands into ensureInfra/deploy/describe/teardown
- Existing CLI commands become thin wrappers that instantiate CloudflarePagesTarget and call its methods
- ALL existing tests must pass without modification (zero regression)

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test` — full suite green, zero regressions.

## 4 — Domain helpers

### 4.1 Create hostname-resolver.ts + tests

Create `domain/hostname-resolver.ts`:
- Pure function `resolveHostname(domain: string, envName: string): string`
- Rules: `prod` → domain as-is, any other env → `<env>.<domain>`
- Examples: `("acme.example.com", "prod")` → `"acme.example.com"`, `("acme.example.com", "dev")` → `"dev.acme.example.com"`

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- hostname-resolver` — covers: prod, dev, staging, custom env name, domain with existing subdomain.

### 4.2 Create env-silo.ts + tests

Create `domain/env-silo.ts`:
- Pure function `computeSilo(projectName: string, envName: string): EnvSilo`
- Returns: `composeProjectName`, `networkName`, `networkSubnet`, `basePath`, `volumePrefix`, `r2CertPath`, `vectorEnvTag`
- Formulas per plan section 9

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- env-silo` — covers: two envs have zero overlapping fields, correct formats, subnet no-collision.

### 4.3 Create compose-env-resolver.ts + tests

Create `domain/compose-env-resolver.ts`:
- Pure function `resolveComposeEnv(config: ComposeEnvInput): string`
- Input: CI secrets (`Record<string,string>`), env name, project name, hostname
- Auto-generates: `SITE_URL` (from hostname), `COMPOSE_PROJECT_NAME`, `NN_ENVIRONMENT`
- Merges CI secrets on top
- Output: `.env` file content (`KEY=value\n`)

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- compose-env-resolver` — covers: SITE_URL computed, COMPOSE_PROJECT_NAME set, CI secrets override auto-generated, valid KEY=VALUE format, special chars handled.

### 4.4 Create caddy-routes-builder.ts + tests

Create `domain/caddy-routes-builder.ts`:
- Pure function `buildCaddyConfig(input: CaddyConfigInput): CaddyJsonConfig`
- Input: array of `{ envName, hostnames, upstream: { host, port } }`, R2 storage config
- Output: full Caddy JSON config with TLS automation (caddy-storage-s3 → R2), routes per hostname → reverse_proxy, HTTP→HTTPS redirect

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- caddy-routes-builder` — covers: single env, multi env, hostnames map to correct upstreams, R2 storage in TLS, valid Caddy JSON structure.

### 4.5 Create vector-env-renderer.ts + tests

Create `domain/vector-env-renderer.ts`:
- Pure function `renderVectorEnv(fields: VectorTenantFields): string`
- Input: `{ clientId, project, vlUrl }`
- Output: `NN_CLIENT_ID=...\nNN_PROJECT=...\nNN_VL_URL=...\n`

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- vector-env-renderer` — covers: correct format, all fields present, no extras.

## 5 — Hetzner adapters (hcloud + R2)

### 5.1 Create hcloud-client.ts + tests

Create `adapters/hetzner/hcloud-client.ts`:
- Typed `fetch()` wrapper to Hetzner Cloud REST API
- Methods: `createServer`, `describeServer`, `deleteServer`, `createFirewall`, `applyFirewall`
- Auth via HCLOUD_TOKEN in constructor
- HTTP errors wrapped with context

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- hcloud-client` — mock fetch, covers: correct payload, response parsing, 4xx/5xx error wrapping, auth header.

### 5.2 Create hcloud-state.ts + tests

Create `adapters/hetzner/hcloud-state.ts`:
- Read/write project state JSON from R2
- State: `{ serverId, ip, tailnetHostname, environments: { [env]: { lastDeploys: ImageRef[] } } }`
- Write uses conditional put (If-Match ETag)
- Retry 3x on ETag mismatch, then throw "state lock contention"

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- hcloud-state` — mock R2, covers: null for missing, ETag match success, stale ETag retry, 3x mismatch throws.

### 5.3 Create r2/r2-client.ts + tests

Create `adapters/r2/r2-client.ts`:
- Wrapper around `@aws-sdk/client-s3` configured for R2
- Methods: `get(key)`, `put(key, body, ifMatch?)`, `delete(key)`, `exists(key)`
- Errors wrapped with key path context

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- r2-client` — mock S3Client, covers: get returns body+etag, missing key → null, put with ifMatch, ETag mismatch throws.

## 6 — SSH session

### 6.1 Create ssh-session.ts + integration tests

Create `adapters/hetzner/ssh-session.ts`:
- Wrapper around `ssh2` Client
- `createSshSession(host, keyPath, user?)` → `SshSession`
- Methods: `exec(cmd)`, `writeFile(path, content)`, `readFile(path)`, `mkdir(path)`, `close()`
- Single connection reused. Connection counter for test assertion.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- ssh-session` — integration with `linuxserver/openssh-server` container. Covers: exec, writeFile+readFile round-trip, mkdir, exactly 1 connection, failing command returns stderr, unreachable host throws.

Requires Docker running locally.

## 7 — Remote Docker Compose

### 7.1 Create remote-docker-compose.ts + integration tests

Create `adapters/hetzner/remote-docker-compose.ts`:
- Takes `SshSession` as dependency
- Methods: `pull`, `up`, `down`, `getPort`, `getLogs`, `waitHealthy`
- Errors wrapped with project name + command

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- remote-docker-compose` — integration with openssh-server + DinD. Covers: pull+up starts containers, getPort returns valid port, getLogs returns content, waitHealthy resolves/rejects, up is idempotent.

Requires Docker running locally.

## 8 — Caddy admin client

### 8.1 Create caddy-admin-client.ts + integration tests

Create `adapters/hetzner/caddy-admin-client.ts`:
- Takes `SshSession` as dependency
- Method: `loadConfig(caddyJson)` — write to temp file, `curl POST http://127.0.0.1:2019/load`, cleanup temp file in finally
- Rejection → throw with Caddy error body

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- caddy-admin-client` — integration with openssh-server + Caddy container. Covers: valid config accepted, invalid rejected with error body, temp file cleaned up.

Requires Docker running locally.

## 9 — VL log verifier

### 9.1 Create vl-log-verifier.ts + tests

Create `adapters/hetzner/vl-log-verifier.ts`:
- Method: `verifyLogs(vlUrl, projectName, envName, timeoutMs)`
- Polls VL `/select/logsql/query` every 5s until ≥1 log or timeout

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- vl-log-verifier` — mock fetch. Covers: immediate find, found after 3 polls, timeout throws, VL unreachable throws.

## 10 — HetznerVpsTarget orchestration

### 10.1 Implement HetznerVpsTarget.ensureInfra

Wire adapters: read state → create VPS if missing → firewall (22/80/443) → wait tailnet → write state → convergence.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- hetzner-vps.target` — covers: first call creates, second call skips, failure propagates.

### 10.2 Implement HetznerVpsTarget.deploy

Wire adapters: load state → 1 SSH session → per env (silo + hostname + env vars + compose pull/up + healthcheck + ports) → Caddy POST → HTTPS probe → VL verify → update state.

**Test:** covers: 2 envs use 1 SSH connection, separate compose projects, Caddy has both envs, deploy without ensureInfra throws, compose failure includes logs.

### 10.3 Implement HetznerVpsTarget.describe + teardown

- `describe`: read state + SSH docker compose ps → TargetState
- `teardown`: compose down + hcloud delete + remove state

**Test:** covers: describe returns state, describe unknown → null, teardown cleans everything.

## 11 — cloud-init

### 11.1 Write cloud-init bootstrap template

~80 lines: docker-ce, tailscale, caddy+s3-plugin, vector, deploy user, UFW (22/80/443), `/opt/apps/`.

**Test:** YAML lint passes. Template renders with test variables.

### 11.2 Write convergence script (idempotent SSH)

Push vector.toml + vector.env, push Caddy base config, ensure project dirs. Skip if unchanged.

**Test:** Run twice — second run is no-op (no restarts).

## 12 — CLI commands

### 12.1 Create hetzner/provision.command.ts

Reads env vars + config → `target.ensureInfra()` → logs success. Register as `hetzner-provision`.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- provision.command`

### 12.2 Create hetzner/deploy.command.ts

Reads env vars + config + image ref + secrets → builds ProjectDeployConfig → `target.deploy()` → logs success. Register as `hetzner-deploy`.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- deploy.command`

### 12.3 Create hetzner/describe.command.ts + teardown.command.ts

- `describe`: `target.describe()` → print JSON
- `teardown`: `target.teardown()` → logs success

Register as `hetzner-describe` and `hetzner-teardown`.

**Test:** `pnpm --filter @nextnode-solutions/infrastructure test -- describe.command teardown.command`

## 13 — CI workflow

### 13.1 Update CI workflows to route by deploy target

- `plan` command outputs `deploy_target` from nextnode.toml
- Route workflows dispatch: `cloudflare-pages` → existing, `hetzner-vps` → new job (build+push GHCR → join tailnet → provision → deploy)
- Zero shell logic in YAML

**Test:** Plan command tests updated. YAML workflow lint passes.

## 14 — Documentation

### 14.1 Update packages/infrastructure/CLAUDE.md

Add: DeployTarget pattern, Hetzner adapter architecture, layer rule extension for target orchestrators, firewall rule, env silo rule, cloud-init split.

**Test:** Review.

## 15 — Final check

### 15.1 Full suite green

```
pnpm --filter @nextnode-solutions/infrastructure test
pnpm --filter @nextnode-solutions/infrastructure run lint
pnpm --filter @nextnode-solutions/infrastructure run format:check
pnpm --filter @nextnode-solutions/infrastructure run type-check
pnpm --filter @nextnode-solutions/infrastructure run build
```

All 5 return exit code 0.
