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

## Worker configuration

Every Worker is declared under `deploy.services`. A service without `url` is callable only through bindings. `entry = false` requires `assets` and deploys assets without a script. `needs` selects backing resources and sibling bindings. `depends_on` controls deployment order without adding a binding.

`deploy.cron` maps schedules to native Worker triggers. The Worker implements its scheduled handler. HTTP `path` and `method` are not used by Cloudflare triggers.

Declare R2 buckets under `services.r2.buckets`. Terraform creates buckets and optional public custom domains. No separate storage adapter or storage credentials are needed.

PlanetScale database creation runs before Terraform because its provider manages roles, not databases. Terraform creates separate runtime and migrator roles. Migrations run with migrator credentials from sensitive outputs.

Internal projects require Access organization settings. Keep alternate public Worker endpoints disabled. Do not interpret a skipped internal smoke check as an authenticated health check.

## Verification

Use the package scripts for type-check, lint and build. Existing infrastructure tests were removed at the operator's request. Do not claim test coverage or create a replacement suite without authorization.

Deploy only through CI on an isolated hostname. Production migration and retirement are separate operations with explicit approval. Keep live resources unchanged while this branch is validated.
