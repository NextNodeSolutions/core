# AGENTS.md

This package is the pipeline CLI that core's workflows run from a checkout of core, plus the `./worker-types` library export that the worker types CLI bundles. These rules add to [the root AGENTS.md](../../AGENTS.md), and [Architecture](docs/architecture.md) shows how the parts fit.

## Layers

- **Point imports one way: the entry point, then `cli`, `adapters`, `domain`, `config`, `kernel`.** The entry point only dispatches. `cli` coordinates one command, `adapters` make every call to the outside, `domain` decides and builds, `config` parses `nextnode.toml`, and `kernel` imports nothing. `domain` stays free of IO, so the same builders serve a deploy in CI and type generation on a developer machine.
- **Import from `config` in `domain` and `adapters` with `import type` only.** A value both layers need goes to `kernel` or arrives as an argument, so `config` stays the one owner of parsing and its schema library.
- **Keep each adapter to one external system, and compose them only in the deploy target adapter.** The target is the one place that orders the HCP, PlanetScale, Terraform and Wrangler calls, so an adapter that calls a sibling hides an ordering decision.
- **Do every IO call in an adapter, including in commands.** A command reads its settings, calls `domain` and the adapters in order, and writes the summary. IO hidden in a command escapes the adapter's error format.
- **Return a discriminated union from `domain` when the command must branch.** The command then chooses which branch is fatal, and the decision reads without any IO around it.
- **Read job settings from environment variables in `cli` only, through its env helpers.** A missing variable then fails with its name before any external call, and adapters take values as arguments. Adapters read only the runner's own variables, such as the output files and the OIDC endpoint, and the Terraform and Wrangler runners forward the environment so the tools authenticate on their own.
- **Resolve organization settings once in `cli` and pass them down.** The resolver asks only for what the project needs, so a project without PlanetScale or internal Workers runs without those settings. Never read an organization variable in `domain` or `adapters`, and never hardcode an account, organization or company domain.
- **Keep the `./worker-types` export path free of environment reads and GitHub runner IO.** It runs on developer machines inside the worker types CLI.
- **Never import the package's root export as a library.** The entry point runs a command as soon as it loads.
- **Log in `cli` and `adapters` only.** `domain` and `config` return data, and the caller decides what deserves a log line.
- **Add a deploy target or provider only when a project needs it.** The target and service registries are the extension points, and an unused target is a path no deploy exercises.

## Code

- **Write erasable TypeScript only, with no enums, namespaces or constructor parameter properties.** Workflows run the source with Node's type stripping and no build, so these pass type-check and fail at runtime.
- **Keep the `#/` alias identical in the manifest's `imports` field and the tsconfig `paths`.** Node resolves it from the manifest and the type checker from tsconfig, so a drift passes one and breaks the other.
- **Write the `.ts` extension in every import, and import types with `import type`.** Node resolves no extension, and it keeps every non-type import at runtime, where a type-only name does not exist.
- **Narrow unknown data with a valibot schema or the `kernel` guards, never with `as`.** TOML files and API responses are outside data, and a cast hides a shape change until it breaks a deploy.
- **Give every validation check an explicit message, and collect every problem before failing.** Those messages are the errors users read, and one run then shows every mistake in the file.
- **Reject a removed `nextnode.toml` key with a message that says what to do instead.** A silently ignored key leaves the project believing a setting still applies.
- **Throw an error that names the field, resource or variable at fault and how to fix it, and let it propagate.** The entry point catches nothing, so Node prints the message, exits non-zero and fails the step. The message is all the operator sees.
- **Set the exit code instead of throwing only when the command must still write its step output or summary.** The publish result step reports a failure this way.
- **Keep generated Terraform and Wrangler configuration deterministic, in a temporary directory removed afterwards.** `nextnode.toml` is the only source, and an unstable order would show changes in every plan.
- **Give every network request, every subprocess of a deploy and every wait loop a time limit.** Send requests through the HTTP adapter's bounded fetch, which the linter enforces in place of a bare `fetch`, and run subprocesses through the process adapter's bounded runner. A hung Terraform call holds the state lock until the job times out, and a request that never answers holds the job just as long, then fails without naming the call.

## Secrets

- **Pass a secret to a later step only as a masked step output.** Every later step inherits `GITHUB_ENV`, and a log line, a summary or an argument shows in the job log. Hand a secret to a tool on stdin or in its environment.
- **Redact credentials from a subprocess's output before it reaches an error.** Errors land in the job log.
- **Keep tokens and secrets out of a request's operation name.** A request that runs out of time fails with that name, and the error lands in the job log.
- **Never declare secret names in `nextnode.toml` or hardcode a list of them.** The repository's Infisical environment is the list, synced whole to every scripted Worker.
- **Download a build artifact outside core's checkout.** Laid over the workspace, a project's artifact could replace the CLI before a credentialed step runs it.
- **Do not extend the transitional vault seeding command or its legacy secret mapping.** Both are deleted with the GitHub secrets.

## Cloudflare and Terraform

- **Never manage one resource with both Terraform and Wrangler.** Terraform owns backing resources, Access, zone rulesets and redirect DNS records. Wrangler owns everything attached to a Worker script. HCP Terraform only stores state. Two owners overwrite each other on every deploy.
- **Never rename a Terraform label or change a resource naming function as a refactor.** Terraform destroys the resource with its data and creates a new one. Treat it as a migration that needs the user's approval.
- **Merge ruleset families, never assign one over the others.** A zone holds one ruleset per phase, so the next apply deletes the rules of the family that was replaced.
- **Emit zone rules in production only.** Both environments share the zone, so a development deploy would overwrite production's rules.
- **Merge service env maps with the merger that throws on a collision, never by spreading.** A spread lets one service's var silently replace another's.
- **Change provider versions and the pinned Workers runtime only in a dedicated change.** They change the behavior of every project on its next run.
- **Never enable a `workers.dev` hostname, and give a sibling Worker a service binding, never a URL.** A second hostname would bypass Access and the zone rules.
- **Never count a skipped health check on an internal Worker as healthy.** CI has no Access login, so that check never ran.

## Verification

- **Do not add a test suite, test files or a test runner without the user's explicit authorization.** The package has no tests by decision.
- **Run this package's type-check, lint and build before you push, with no new lint warnings.** Its own CI runs lint only. The root [checks](../../AGENTS.md#checks) say how to run one package.
- **Also run the worker types package's type-check and build when a change reaches the `./worker-types` export.** That package bundles this build and keeps third-party imports external, so a new runtime dependency on that path also goes into its `dependencies`.
- **Validate a deployment change through CI on an isolated hostname, never from a local machine.** These checks prove only that the code compiles. Production data migration and the retirement of live resources are separate operations that need the user's approval, as [working against real systems](../../AGENTS.md#working-against-real-systems) requires.

## Extending

### Add a command

1. Pick its group by the config it needs. A standalone command reads no `nextnode.toml`. A plan command takes any valid project. A deploy command takes a deployable project and is skipped for any other.
2. Write its module in `cli`, named after the command. Put each decision in `domain` and each IO call in an adapter.
3. Register it in the entry point's map for its group.
4. Call it from a workflow step, as below.

### Call the CLI from a workflow step

1. Start the job with the setup action in infra mode, with deps mode off unless the job runs the project's scripts and holds no credential.
2. Run the command from the package directory of core's checkout, with `PIPELINE_CONFIG_FILE` as an absolute path and `PIPELINE_ENVIRONMENT` when it resolves an environment.
3. For credentials, add a `load-secrets` step with id `vault` and pass its outputs in the step's `env`. Grant `id-token: write` only on that job.
4. Pass organization settings as `vars.NAME` lines, and the vault ids at workflow level as the other workflows do.
5. Before a command that runs Terraform, set up Terraform without its wrapper, because the runner reads Terraform's raw output and exit codes.
6. Expose a step output in the job's `outputs` when another job reads it. The quality matrix embeds the path of core's checkout, so change it together with the setup action.

### Add a `nextnode.toml` key

1. Add the field to its config type, with its default beside it.
2. Validate it in its section's schema, map the snake_case key to the camelCase field, and leave an absent optional field absent, because builders test presence.
3. Consume it in `domain`.
4. Describe it in [Configuration](docs/configuration.md).

### Add a backing service

1. Add its name and config to the typed service maps in `config`. The compiler then lists each place that needs an entry.
2. Validate its table and call that from the services validator.
3. Extend the backing config and the Terraform outputs, with a placeholder for type generation, which runs before any provision.
4. Add its Terraform resource and outputs to the Terraform builders.
5. Add its binding to the Wrangler builder and the env type mapping, filtered by each Worker's `needs`.
6. Require `wipe_data` in teardown when it holds data.
7. Add a migration variant and the plan flag when it has migrations.
8. Add a managed resource handler, in the order Terraform needs, when Terraform cannot create it.
9. Pass its credentials through the target factory and its settings through the organization resolver, and add their `env` lines to every job that runs provision, migrate-remote, deploy, plan-infra or teardown.
10. Generate types for a Worker that needs it, and document it on its page under `docs/`.

### Add a deploy target

1. Add its name to the target list and its sections to the config types.
2. Register its provider validator under its name. Validation runs the provider of the declared `deploy.target`, or of the project type's default when the key is absent. The registry's type only accepts a provider whose section carries the target it is registered under, so the target registry and the implied services read the target that validated the file. Keep the project type defaults as they are, because every project that omits the key would move to the new target.
3. Allow the backing services it supports.
4. Add its result variants to the deploy, teardown and resource outcome unions, each with a distinct `kind`.
5. Put its builders in `domain` and its IO in `adapters`, under the provider's name. Its target implements the deploy target interface.
6. Register its factory in the `cli` target registry, and reach the target only through it, from every command.

### Add a zone ruleset family

1. Build its rules with the shared zone ruleset builder and label helpers.
2. Merge the family with the others.
3. Emit it in production only.
