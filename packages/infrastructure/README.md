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

`deploy.target` is optional and only accepts `cloudflare-workers`. Static assets use `entry = false` and an `assets` directory. Backing services are D1, KV, Queues, R2 and PlanetScale. Declare secret names in the service or global deploy pool. Values come from the secret vault, described under [Secrets](#secrets).

## Organization settings

GitHub organization Actions variables are the source of organization settings. Set `TF_CLOUD_ORGANIZATION` for every deployment. Set `PLANETSCALE_ORGANIZATION` when using PlanetScale. Internal projects additionally require `COMPANY_DOMAIN` and `ACCESS_SESSION_DURATION` for their Access email policy and session lifetime. The CLI rejects missing settings, with no company-specific defaults.

Deployment credentials live in the vault folder `/ci`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TF_CLOUD_TOKEN`, `NEXTNODE_APP_ID`, `NEXTNODE_APP_PRIVATE_KEY` and `NPM_TOKEN`. PlanetScale requires `PLANETSCALE_SERVICE_TOKEN_ID` and `PLANETSCALE_SERVICE_TOKEN`. The Terraform token must be a team or user token, not an organization token. Internal deployments need Cloudflare Access Apps and Policies permission.

## Secrets

The Infisical project `core-vault`, environment `main`, is the only source of secrets. GitHub holds none. GitHub Variables stay in GitHub because they are not secrets.

| Folder                           | Content                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `/ci`                            | Platform credentials shared by every pipeline              |
| `/projects/<repo>/<environment>` | One repository's secrets for `development` or `production` |

A project's names resolve against `/ci` overlaid by its own folder, the project folder winning. To add a secret, store it in the right folder and declare its name in `nextnode.toml`. Never reference `secrets.<NAME>` in a workflow.

Every job that needs a secret starts with `node src/index.ts load-secrets`. The job trades its GitHub OIDC token for a short-lived vault token, then exposes each `/ci` secret as a masked step output, `steps.vault.outputs.<NAME>`. With `PIPELINE_ENVIRONMENT` set, it also emits the project pool as the `ALL_SECRETS` output. Provision writes generated secrets to the project folder, and later jobs of the same run read them live.

A caller that sets its own `permissions:` block must grant `id-token: write`. Without a block, the called workflow can request it.

### Vault identity

The machine identity `github-actions` uses OIDC Auth and needs read and write access to `/ci` and `/projects/**` in `core-vault`. Its id goes in the organization Variable `INFISICAL_IDENTITY_ID`.

| Field              | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| OIDC Discovery URL | `https://token.actions.githubusercontent.com`                                     |
| Issuer             | `https://token.actions.githubusercontent.com`                                     |
| Subject            | `repo:NextNodeSolutions/*,repo:NextNodeSolutions@*/*`                             |
| Audiences          | `https://app.infisical.com`                                                       |
| Claims             | `job_workflow_ref` = `NextNodeSolutions/core/.github/workflows/*@refs/heads/main` |
| Access token TTL   | 900                                                                               |

The `job_workflow_ref` claim is the trust boundary: only core's workflow files on `main` can log in, whichever repository calls them. In a called workflow the claim names the called file. In a workflow run directly, such as Seed Vault or teardown, it names that workflow's own file, so the same glob covers both. The second subject form covers repositories that send the immutable subject format with numeric ids.

### Moving off GitHub secrets

This is transitional and is removed with the GitHub secrets.

1. Create the identity and the Variable before merging the vault change. Without them, every pipeline fails at `load-secrets`.
2. Run the Seed Vault workflow in core once. It copies the platform credentials into `/ci`.
3. Deploy each consumer repository once per environment. Its `check-secrets` job copies its declared secrets into its project folder. Neither copy overwrites a secret the vault already holds.
4. Delete the GitHub secrets, then delete `seed-vault.yml`, the seed step of `deploy.yml`, `cli/vault/seed-vault.command.ts`, `domain/vault/legacy-seed.ts` and the `secrets: inherit` lines of the callers.

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
