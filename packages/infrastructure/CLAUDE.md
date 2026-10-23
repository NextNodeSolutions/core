# Infrastructure

Read [README.md](README.md) before changing deployment configuration or workflows.

The CLI runs from a core checkout in GitHub Actions. Do not publish this package to npm. The worker-types package consumes its library export.

## Dependency rules

- `index.ts` dispatches commands. Put command coordination in `cli/`.
- `cli/` reads environment variables through `cli/env.ts` and calls configuration, domain functions and adapters.
- `domain/` contains pure transformations. Import configuration types and kernel primitives, not adapters, environment variables, filesystem or network operations.
- `adapters/` performs IO and translates external responses into owned types. Keep decisions in the domain.
- `config/` parses and validates `nextnode.toml`. Import kernel primitives, standard-library functions and schema dependencies, not CLI or adapters.
- `kernel/` contains pure provider-independent primitives without in-app imports.

## Deployment ownership

Terraform owns backing resources, Access policies, firewall rules and redirects. Wrangler owns Worker code, custom domains, bindings, secrets and cron triggers. HCP Terraform owns state. Never manage the same resource through both tools.

Keep the deployment registry and service-to-target declarations as the extension points. Add another provider only for an actual consumer.

Organization settings have one resolver in `cli/deploy/organization.ts`. Pass its result into adapters and pure Terraform builders. Do not read organization environment variables in domain code or hardcode account names and company domains.

## Secrets

The Infisical vault is the only source of secrets. Never add a `secrets.<NAME>` reference to a workflow, never declare secret names in `nextnode.toml` and never hardcode a list of them: a project environment is the list. The CI project holds the platform credentials. Each repository's project, found by the repository's name, holds its Workers' secrets, synced whole to every scripted Worker at deploy. `domain/vault/secret-vault.ts` owns the project and environment layout, `cli/vault/open-vault.ts` the OIDC login and lookup, and `load-secrets` the read. A job with `id-token: write` runs core's CLI only: never add a caller script, build or dependency install to one. `publish-package.yml` releases core's own packages and refuses other callers. The seed command and `domain/vault/legacy-seed.ts` are transitional and go away with the GitHub secrets.

## Worker configuration

Every Worker is declared under `deploy.services`. A service without `url` is callable only through bindings. `entry = false` requires `assets` and deploys assets without a script. `needs` selects backing resources and sibling bindings. `depends_on` controls deployment order without adding a binding.

A service with `image` is a container service: `config/validation/deploy-container-services.ts` validates it and `domain/cloudflare/workers/container-wrangler-config.ts` builds its document. Core deploys its own gateway Worker, `runtime/container-gateway/worker.ts`, in front of each container. The gateway's Durable Object class drives one instance through `@cloudflare/containers`, and `runtime/container-gateway/contract.ts` is the only code the gateway shares with `src/`. A container reaches only PlanetScale, through a `DATABASE_URL` secret for the role `postgres_role` names, and R2, through its S3 endpoint with the keys of a Terraform API token scoped to the project's buckets; never emit a binding for it. Terraform outputs the runtime role's credentials only when a container connects as that role. The `containers` job of `deploy.yml` builds the caller's Dockerfile with `docker/build-push-action` into an OCI archive, one matrix entry per service from the `plan` job's `containers_matrix` output, with no credential. `deploy` pushes the archive with `skopeo copy` (`adapters/skopeo/push.ts`) under registry credentials minted by `adapters/cloudflare/containers/registry.ts`, and never builds or loads one: it runs no Docker. The credentials go through an auth file, never argv. Keep `docker build` out of every job with `id-token: write`. The push starts in `DeployTarget.prepareDeploy`, while the backing env is read, and `deploy` awaits it, so its failure surfaces there. The gateway receives the image reference as a control var and includes it in its env digest, so a new image restarts the container at the first request. `adapters/cloudflare/api.ts` is the REST client for what wrangler cannot do reliably: the container application lookup, the registry credentials and the R2 S3 key pair of the CI token. The registry API in `registry.ts` lists, deletes and collects image tags for the prune and the teardown.

Wrangler is an exact dependency of this package. `adapters/wrangler/runner.ts` runs its installed `bin/wrangler.js` with `process.execPath`; never call it through `pnpm dlx` or `npx`. Services deploy concurrently within a dependency level (`orderWorkerDeployLevels`), and the smoke checks run concurrently, alongside the image prune. The production gate is a step of the `plan` job, not a job of its own. `plan` outputs `has_worker_build`; when it is false, `build` installs no caller dependency and runs no build.

`deploy.cron` maps schedules to native Worker triggers. The Worker implements its scheduled handler. HTTP `path` and `method` are not used by Cloudflare triggers.

Declare R2 buckets under `services.r2.buckets`. Terraform creates buckets and optional public custom domains. No separate storage adapter or storage credentials are needed.

PlanetScale database creation runs before Terraform because its provider manages roles, not databases. Terraform always creates the migrator role. It creates the runtime role only for a Worker's Hyperdrive config or a container on that role, and the Hyperdrive config only when a Worker needs `planetscale`. Migrations run with migrator credentials from sensitive outputs.

Internal Workers, per service or through `project.internal`, require Access organization settings. Keep alternate public Worker endpoints disabled. Do not interpret a skipped internal smoke check as an authenticated health check.

## Verification

Use the package scripts for type-check, lint and build. Existing infrastructure tests were removed at the operator's request. Do not claim test coverage or create a replacement suite without authorization.

Deploy only through CI on an isolated hostname. Production migration and retirement are separate operations with explicit approval. Keep live resources unchanged while this branch is validated.
