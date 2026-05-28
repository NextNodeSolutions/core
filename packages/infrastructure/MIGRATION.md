# Migration notes — @nextnode-solutions/infrastructure

Manual operational steps that the deploy pipeline cannot perform itself.
Run once per project that was provisioned against a previous version.

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
