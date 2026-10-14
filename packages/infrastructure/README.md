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

An Infisical project dedicated to CI, environment `main`, is the only source of secrets. Its id is the organization Variable `INFISICAL_PROJECT_ID`. No identity other than the two below is a member, so no local or agent session can read it. GitHub holds no secret. GitHub Variables stay in GitHub because they are not secrets.

| Folder                                   | Content                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `/ci`                                    | Platform credentials shared by every pipeline, read-only   |
| `/projects/<owner>/<repo>/<environment>` | One repository's secrets for `development` or `production` |

A project's names resolve against `/ci` overlaid by its own folder, the project folder winning. To add a secret, store it in the project folder and declare its name in `nextnode.toml`. Nothing else: the first provision creates a missing folder, and the identities below cover every repository of the organization. Never reference `secrets.<NAME>` in a workflow.

Every job that needs a secret starts with `node src/index.ts load-secrets`. The job trades its GitHub OIDC token for a short-lived vault token, then exposes each `/ci` secret as a masked step output, `steps.vault.outputs.<NAME>`. With `PIPELINE_ENVIRONMENT` set, it also emits the project pool as the `ALL_SECRETS` output. Provision writes generated secrets to the project folder, and later jobs of the same run read them live.

A calling workflow declares its permissions, `id-token: write` included, so it keeps working if the organization's default token becomes read-only:

```yaml
permissions:
    contents: read
    actions: read
    id-token: write

jobs:
    deploy:
        uses: NextNodeSolutions/core/.github/workflows/deploy.yml@main
        with:
            environment: development
```

A caller of `plan-diff.yml` grants `contents: read`, `pull-requests: write` and `id-token: write`. No caller passes `secrets: inherit`.

### Trust boundary

Any step of a job granted `id-token: write` can mint the job's OIDC token, and the vault accepts it. Two rules follow.

- Such a job runs core's pipeline CLI only. The caller's dependencies install and its build runs in the `build` job of `deploy.yml`, which holds no credential. `deploy` ships the uploaded result and never installs the caller's dependencies, so the Worker bundle must be self-contained. The exception is a PlanetScale migration, which runs the caller's migrate command in `migrate`.
- `publish-package.yml` is bound to core. Its `publish` job runs the package's release tooling, caller code by construction, so it refuses any other calling repository. Core's own code and lockfile are the trusted base, like the CLI.
- `deploy.yml` logs in as the deploy identity, whose token opens the folder of the repository and environment that minted it, nothing else. Its role templates the project folder on the token's `repository` and `environment` claims. Infisical refuses that login from a job without a GitHub environment, so every job of `deploy.yml` that loads secrets declares one.
- Every other workflow logs in as the platform identity, which reads `/ci` only.

The `job_workflow_ref` claim is what each identity trusts: only core's workflow files on `main` can log in, whichever repository calls them. In a called workflow the claim names the called file. In a workflow run directly, such as Seed Vault or teardown, it names that workflow's own file. The `repository_owner_id` claim pins the organization by its immutable id. This trust is exactly as strong as the protection of core's `main`: no direct push, required checks.

### Vault setup

Created once. The project holds one environment, slug `main`, and two root folders, `/ci` and `/projects`, created by hand so that no identity needs rights on the root.

Both identities are organization identities with the organization role No Access, members of the CI project only, with OIDC Auth:

| Field              | Value                                         |
| ------------------ | --------------------------------------------- |
| OIDC Discovery URL | `https://token.actions.githubusercontent.com` |
| Issuer             | `https://token.actions.githubusercontent.com` |
| Subject            | `repo:NextNodeSolutions/*`                    |
| Audiences          | `https://app.infisical.com`                   |
| Access token TTL   | 900                                           |

Infisical matches the Subject as one glob, with no comma list. Claims accept a comma-separated list per claim.

| Setting                     | `github-actions-deploy`                                               | `github-actions-platform`                                    |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Claim `repository_owner_id` | `259621712`                                                           | `259621712`                                                  |
| Claim `job_workflow_ref`    | `NextNodeSolutions/core/.github/workflows/deploy.yml@refs/heads/main` | `NextNodeSolutions/core/.github/workflows/*@refs/heads/main` |
| Claim Mapping (Advanced)    | `repository` = `repository`, `environment` = `environment`            | none                                                         |
| Project role                | `ci-deploy`                                                           | `ci-platform`                                                |
| Organization Variable       | `INFISICAL_DEPLOY_IDENTITY_ID`                                        | `INFISICAL_PLATFORM_IDENTITY_ID`                             |

Role `ci-platform`:

| Resource | Actions                     | Secret path condition |
| -------- | --------------------------- | --------------------- |
| Secrets  | Describe Secret, Read Value | Equal `/ci`           |

Role `ci-deploy`:

| Resource       | Actions                                   | Secret path condition                                                                                      |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Secrets        | Describe Secret, Read Value               | Equal `/ci`                                                                                                |
| Secrets        | Describe Secret, Read Value, Create, Edit | Glob `/projects/{{ identity.auth.oidc.claims.repository }}/{{ identity.auth.oidc.claims.environment }}/**` |
| Secret Folders | Read, Create                              | Glob `/projects/**`                                                                                        |

Folder creation is open under `/projects` so a first provision can create a project's folder. A folder name reveals nothing, and secret access stays scoped by the row above.

### Moving off GitHub secrets

This is transitional and is removed with the GitHub secrets.

1. Set up the vault and the three organization Variables before merging the vault change. Without them, every pipeline fails at `load-secrets`.
2. Give `github-actions-platform` a temporary additional privilege of one hour: Secrets Create and Edit on Equal `/ci`, Secret Folders Read on Equal `/`. Then run the Seed Vault workflow in core once. It copies the platform credentials into `/ci`, never overwrites, and the privilege expires by itself. Storing the eight names of `domain/vault/legacy-seed.ts` by hand replaces the run.
3. Store each repository's own secrets in its project folders by hand. GitHub repository and environment secrets are not copied.
4. Delete the GitHub secrets, then `seed-vault.yml`, `cli/vault/seed-platform-secrets.command.ts` and `domain/vault/legacy-seed.ts`. Callers switch to `deploy.yml` and drop their `secrets: inherit` line.

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
