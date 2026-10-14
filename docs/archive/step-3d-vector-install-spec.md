# Step 3d — `nextnode-deploy install-vector` specification

Spec handoff doc for the agent implementing Step 3d of
[`monitoring-plan.md`](./monitoring-plan.md). Read that plan first for the
surrounding architecture.

## Context

- **Tailscale (3a) is already set up.** All NextNode client VPSes are joined
  to the tailnet, ACLs restrict `:9428` to `tag:client-vps → tag:monitoring`.
  This spec does NOT include Tailscale join logic.
- **Config files already exist** in the monitoring package:
    - `packages/monitoring/deploy/vector/vector.toml.template` — Vector
      config with `docker_logs` + `journald` sources, a `remap` transform
      that injects tenant fields from env vars, and an HTTP sink to VL.
    - `packages/monitoring/deploy/vector/vector-sidecar.compose.yml` —
      Docker sidecar compose file.
- **Zero app-level secrets on the logs pipeline.** The tailnet is the trust
  boundary. No bearer tokens, no API keys, no mTLS.

## Goal

A CLI command that, given an SSH host and tenant identity fields, installs
the Vector sidecar on the client VPS and verifies the first log lands in
VictoriaLogs.

## Package placement — recommendation

**New package**: `packages/nextnode-deploy`.

Rationale:

- `packages/infrastructure` is focused on Cloudflare Pages deploys. Adding
  VPS provisioning would bloat its scope into a god-package.
- VPS deploys are stateful (SSH, remote execution) — a different shape than
  the current Cloudflare API calls.
- The new package will eventually own the full VPS lifecycle (provisioning,
  backups, cert renewals), not just Vector install.

Follow the strict layered pattern used in `packages/monitoring` and
`packages/infrastructure`:

```
packages/nextnode-deploy/
  src/
    index.ts                            — argv dispatch, ~4 lines
    cli/
      commands.ts                       — registry + runCommand
      env.ts                            — typed env readers
      install-vector.command.ts         — orchestrator
      upgrade-vector.command.ts         — idempotent re-render + restart
    domain/
      vector-env-renderer.ts            — PURE: (fields) → env file string
      vector-env-renderer.test.ts
    adapters/
      ssh-client.ts                     — wraps ssh / scp via child_process
      remote-docker.ts                  — docker compose over SSH
      vl-log-verifier.ts                — polls VL /select/logsql/query
```

Layer import rules identical to `packages/monitoring/CLAUDE.md`:

| Layer        | May import from              | Forbidden                               |
| ------------ | ---------------------------- | --------------------------------------- |
| `index.ts`   | `cli/commands` only          | domain, adapters, env vars, logger      |
| `cli/*`      | domain, adapters, logger     | raw `process.env` outside `cli/env.ts`  |
| `domain/*`   | other domain, shared types   | any IO, env vars, logger, adapters      |
| `adapters/*` | shared types, domain (types) | business decisions, cross-adapter logic |

## CLI contract

```
nextnode-deploy install-vector \
  --host=<ip-or-tailnet-hostname> \
  --ssh-user=root \
  --ssh-key=~/.ssh/nextnode-ops \
  --client=<slug> \
  --project=<slug> \
  --environment=production \
  --vl-url=http://monitoring.tailnet-xxxx.ts.net:9428 \
  --compose-project-dir=/opt/<client-project>
```

All flags required except `--ssh-user` (default `root`) and
`--environment` (default `production`).

## Execution flow — `install-vector`

1. Validate all flags, fail fast on missing/invalid values.
2. SSH to host: `mkdir -p /etc/vector`.
3. `scp packages/monitoring/deploy/vector/vector.toml.template
→ /etc/vector/vector.toml`. Vector performs runtime env
   substitution, so the file ships as-is.
4. Render `vector.env` **locally** via the pure domain function:
    ```
    NN_CLIENT_ID=acme-corp
    NN_PROJECT=web
    NN_ENVIRONMENT=production
    NN_VL_URL=http://monitoring.tailnet-xxxx.ts.net:9428
    ```
    Then `scp → /etc/vector/vector.env`.
5. `scp packages/monitoring/deploy/vector/vector-sidecar.compose.yml
→ <compose-project-dir>/vector-sidecar.compose.yml`.
6. Over SSH:
   `cd <compose-project-dir> &&
docker compose -f vector-sidecar.compose.yml up -d vector`.
7. **Verification loop.** Poll VL from the machine running this CLI (which
   must also be on the tailnet). Query:
    ```
    GET {vl-url}/select/logsql/query?query={client_id="<slug>",project="<slug>"}&limit=1
    ```
    with `_time:>now-90s`. Expect ≥1 line within 90 s. On success, print
    "Vector installed, first log verified". On timeout, fail with the last
    50 lines of `docker logs vector`.

## Idempotency

- Re-running `install-vector` with the same args must be a no-op: the
  Vector container stays `running`, configs are overwritten but
  byte-identical, `docker compose up -d` reconciles without restart.
- `upgrade-vector` is semantically separate: same flow, but explicitly
  restarts the container (`docker compose up -d --force-recreate vector`)
  so env changes take effect. Can be merged with `install-vector` if the
  implementing agent prefers; keeping them separate makes the intent
  clearer in deploy logs.

## Error handling (NO silent fallbacks — global rule)

- SSH unreachable → fail immediately, log the ssh stderr, non-zero exit.
- `scp` non-zero → fail, include the transfer destination in the error.
- `docker compose up` non-zero → fetch `docker logs --tail 50 vector` over
  SSH, include in the error message, non-zero exit.
- VL verify timeout (90 s) → fail, **leave the container running** for
  manual debug, include the last 50 lines of Vector logs in the error.
- Never catch-and-swallow. Every adapter wraps its errors with context
  (which host, which step), re-throws, and the CLI layer converts to a
  non-zero exit with a readable message.

## Test plan

- **Domain** — pure unit tests on `vector-env-renderer`:
    ```ts
    expect(
    	renderVectorEnv({
    		clientId: 'acme',
    		project: 'web',
    		environment: 'production',
    		vlUrl: 'http://m:9428',
    	}),
    ).toBe('NN_CLIENT_ID=acme\nNN_PROJECT=web\n...')
    ```
    No mocks, no fixtures beyond input values.
- **Adapter** — integration tests with a local `linuxserver/openssh-server`
  container acting as a fake VPS. Run `ssh-client.ts` against it, assert
  files land in the right place.
- **CLI e2e** — spin up a throwaway Docker-in-Docker container, run the
  full `install-vector` flow against it, use a local mock VL to verify
  the push, assert cleanup.
- Use `vitest` + `@nextnode-solutions/standards/vitest/backend` to match
  the rest of the monorepo.

## Secrets handling

- SSH key path passed via `--ssh-key`, never echoed in logs.
- No other secrets — there is no token, API key, or bearer auth on this
  pipeline. If you find yourself adding one, you're wrong; re-read
  `packages/monitoring/CLAUDE.md` → "Trust boundary — Tailscale/private
  network".

## Definition of done

1. Running `install-vector` against a fresh VPS (Vector absent) → Vector
   container starts and first log is visible in VL within 90 s.
2. Re-running with identical args → no-op, zero errors, container still
   `running`.
3. Running with a changed `--environment` → container restarts, new logs
   appear in VL with the updated `environment` label.
4. All of: `pnpm --filter @nextnode-solutions/nextnode-deploy test`,
   `format:check`, `lint`, `type-check`, `build` are green.
5. New package registered in `pnpm-workspace.yaml` (already covers
   `packages/*`, so this is automatic).
6. `docs/monitoring-plan.md` Step 3d checkboxes marked `[x]`.

## Out of scope for 3d

- Provisioning a fresh VPS (OS install, firewall, Docker install).
- Joining the tailnet (done in 3a).
- SSH cert renewal or rotation.
- Automated rollback on Vector failure — ops picks up the pager.
- Managing the monitoring VPS itself; this CLI only acts on **client**
  VPSes. The monitoring VPS stack is in
  `packages/monitoring/deploy/docker-compose.yml` and is brought up
  manually for now (Step 7 will automate that).
