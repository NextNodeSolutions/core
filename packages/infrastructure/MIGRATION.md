# Migration notes — @nextnode-solutions/infrastructure

Manual operational steps that the deploy pipeline cannot perform itself.
Run once per project that was provisioned against a previous version.

## GitHub secrets moved to the Infisical vault

Every secret the pipeline consumes is now read from Infisical (project
`core-vault`, environment `main`). GitHub holds none: no org secret, no
environment secret, no repo secret. The workflows authenticate through GitHub
OIDC, so no Infisical credential is stored in GitHub either.

| Vault folder             | Holds                                                                                        | Was                      |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------ |
| `/ci`                    | Platform credentials shared by the fleet (Cloudflare, Hetzner, Tailscale, R2, HCP, npm, App) | Org secrets              |
| `/projects/<repo>/<env>` | Secrets of one repo in one environment, including the generated ones                         | Repo environment secrets |

`<repo>` is the GitHub repository name and `<env>` is `development` or
`production`. A name declared in `nextnode.toml` resolves against `/ci`
overlaid by the project folder, the project winning. Secret names are unchanged.

GitHub Variables (`vars.*`: build args, `NN_VL_URL`, `NN_CLIENT_ID`) are not
secrets and stay in GitHub.

### 1. Create the machine identity (once, before merging)

In Infisical, organization `Nextnode`:

1. Access Control → Identities → create `github-actions`.
2. Remove the default Universal Auth method, add **OIDC Auth**:

    | Field              | Value                                                                             |
    | ------------------ | --------------------------------------------------------------------------------- |
    | OIDC Discovery URL | `https://token.actions.githubusercontent.com`                                     |
    | Issuer             | `https://token.actions.githubusercontent.com`                                     |
    | Subject            | `repo:NextNodeSolutions/*`                                                        |
    | Audiences          | `https://app.infisical.com`                                                       |
    | Claims             | `job_workflow_ref` = `NextNodeSolutions/core/.github/workflows/*@refs/heads/main` |
    | Access Token TTL   | `900` (seconds)                                                                   |

    The `job_workflow_ref` claim is the access rule: only a workflow file of
    `core` on `main` can log in, whichever repo calls it. A repo's own workflow
    cannot, and neither can a branch of `core`. To drop the wildcard, list each
    workflow file instead, comma-separated.
    The short token lifetime is enough: each command logs in right before it
    reads or writes.

3. Add the identity to the project `core-vault` with read and write access to
   `/ci` and `/projects/**`. Write is needed by provision (generated secrets,
   R2 credential rotation) and by the transitional seeding below.
4. Store the identity id as an org-level GitHub Variable, visible to every repo:

    ```sh
    gh variable set INFISICAL_IDENTITY_ID --org NextNodeSolutions --visibility all
    ```

A caller workflow that declares its own `permissions:` block must grant
`id-token: write`. Callers without one need no change.

### 2. Seed the vault from GitHub (transitional)

GitHub secret values cannot be read back, so they are copied from inside
workflow runs by the `seed-vault` command. It never overwrites a secret the
vault already resolves.

1. Merge, then run the **Seed Vault** workflow in `core` once. It fills `/ci`
   and `/projects/core/production`.
2. Deploy each consumer project once per environment. The `check-secrets` job
   copies that project's secrets into `/projects/<repo>/<env>` before checking
   them. Until this is done for an environment, keep `secrets: inherit` in the
   caller and the GitHub secrets in place.

Not carried over: an environment secret that overrides a platform secret of the
same name. Add it by hand to the project folder.

### 3. Remove the GitHub side

Once every project has deployed in each environment and the vault folders are
complete:

1. Delete the org secrets and each repo's environment secrets
   (`gh secret list --org NextNodeSolutions`, `gh secret delete ...`).
2. Delete the transitional code: the `Seed vault from GitHub secrets` step of
   the three deploy workflows, `.github/workflows/seed-vault.yml`,
   `src/cli/vault/seed-vault.command.ts`, `src/domain/vault/legacy-seed.ts` and
   the `seed-vault` entry in `src/index.ts`. The `environment:` binding of the
   `check-secrets` jobs only served the seed step.
3. Drop `secrets: inherit` from the caller workflows.

### Day to day

- Add or rotate a secret: edit it in the vault folder. The next job reads it;
  there is no snapshot to wait for.
- Generated secrets (`{ name, generate, length }`) and the embedded postgres
  password are written to the project folder by `provision`. The deploy job of
  the same run already sees them, so the old "provision, then re-trigger the
  deploy" step is gone.

## P7-14 — `PG_EXPORTER_PASSWORD` moved from org-secret to env-secret

The postgres-exporter password is now stored as a GitHub **env-secret**
named literally `PG_EXPORTER_PASSWORD`, scoped to the project's
repository and pipeline environment (`development` / `production`). The
previous **org-secret** `PG_EXPORTER_PASSWORD_<PROJECT>` (uppercase
project slug, hyphens → underscores) is no longer read by `loadEnv` and
no longer written by `provision` / `rotate-pg-exporter-password`.

The next `provision` run on a project will regenerate the password as an
env-secret and bake it into the postgres-exporter role on first boot —
no action needed if the project has not yet been deployed.

For projects already deployed against the old org-secret scheme:

1. Rotate the in-cluster role on the live DB so it matches the new
   env-secret (the next deploy will reset it on first boot of a clean
   volume, but a live cluster keeps the old hash):

    ```sql
    ALTER ROLE postgres_exporter PASSWORD '<value of new PG_EXPORTER_PASSWORD env-secret>';
    ```

2. Delete the now-orphaned org-secret so it stops showing up in
   `ALL_SECRETS` for every project in the org:

    ```sh
    gh secret delete --org NextNodeSolutions PG_EXPORTER_PASSWORD_<PROJECT>
    ```

    Where `<PROJECT>` is the uppercase project slug with hyphens replaced
    by underscores (e.g. `my-cool-app` → `MY_COOL_APP`).
