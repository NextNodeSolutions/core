# Infrastructure

Cloudflare Workers deployment CLI consumed directly from core by GitHub Actions. This package is not published to npm.

## Configuration

```toml
[project]
name = "my-app"
type = "app"
domain = "example.com"

[deploy.services.web]
entry = "dist/server/entry.mjs"
url = "example.com"
needs = ["d1"]

[services.d1]
```

`deploy.target` is optional and only accepts `cloudflare-workers`. Static assets use `entry = false` and an `assets` directory. Backing services are D1, KV, Queues, R2 and PlanetScale. Declare secret names in the service or global deploy pool. Values come from GitHub secrets.

## Organization settings

GitHub organization Actions variables are the source of organization settings. Set `TF_CLOUD_ORGANIZATION` for every deployment. Set `PLANETSCALE_ORGANIZATION` when using PlanetScale. Internal projects additionally require `COMPANY_DOMAIN` and `ACCESS_SESSION_DURATION` for their Access email policy and session lifetime. The CLI rejects missing settings, with no company-specific defaults.

Deployment credentials remain secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TF_CLOUD_TOKEN`, `NEXTNODE_APP_ID`, `NEXTNODE_APP_PRIVATE_KEY`. PlanetScale requires `PLANETSCALE_SERVICE_TOKEN_ID` and `PLANETSCALE_SERVICE_TOKEN`. The Terraform token must be a team or user token, not an organization token. Internal deployments need Cloudflare Access Apps and Policies permission.

## CI

Call `.github/workflows/deploy.yml` with `environment` and optional `config_file`. Development prefixes the configured hostname with `dev.`. Terraform provisions resources before D1 and PlanetScale migrations. Wrangler deploys code and checks public routed Workers at `/healthz`.

`project.internal = true` creates Access applications in both environments. Internal smoke checks are skipped because CI has no Access login. Verify the Access login redirect separately.

`.github/workflows/plan-diff.yml` reports Terraform changes on pull requests. `.github/workflows/teardown.yml` is manually dispatched with target repository, environment and project-name confirmation. Stateful teardown additionally requires `wipe_data`. HCP workspace history remains after teardown.

PlanetScale migrations use `services.planetscale.migrate_command`, defaulting to the command defined in `domain/deploy/target.ts`, from the directory containing `nextnode.toml`. Only the migration subprocess receives `DATABASE_URL` built from sensitive migrator outputs.

## Checks

```sh
pnpm --filter @nextnode-solutions/infrastructure type-check
pnpm --filter @nextnode-solutions/infrastructure lint
pnpm --filter @nextnode-solutions/infrastructure build
```

Infrastructure tests were deleted by operator request. Successful compilation does not prove deployment, Access login or PlanetScale migrations.

Layer rules are in [CLAUDE.md](CLAUDE.md). Historical server deployment documents are archived and are not instructions for this CLI.
