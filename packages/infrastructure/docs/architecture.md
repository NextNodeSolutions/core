# Architecture

This page explains how the CLI is split, what each command does from start to end, and what a failure leaves behind.

## Parts

```mermaid
flowchart TD
    entry["Entry point<br/>picks the command"]
    cli["cli<br/>one module per command"]
    config["config<br/>nextnode.toml types and validation"]
    domain["domain<br/>pure builders and decisions"]
    adapters["adapters<br/>every IO call"]
    kernel["kernel<br/>shared guards"]
    external["External systems"]

    entry --> cli
    entry --> config
    cli --> config
    cli --> domain
    cli --> adapters
    adapters --> domain
    adapters --> external
    domain -. "types only" .-> config
    config --> kernel
    domain --> kernel
    adapters --> kernel
```

The entry point reads the command name, loads `nextnode.toml` when the command needs it, and calls the command. A command reads its environment variables, asks `domain` for every decision and document, and asks `adapters` for every call to the outside. `domain` never performs IO, so the same builders serve a deploy in CI and type generation on a developer machine. `config` turns the TOML file into typed sections and knows nothing about Cloudflare. `kernel` holds the few helpers every layer shares.

## Boundary contracts

- **Entry point to command.** A standalone command runs without `nextnode.toml`. A plan command receives any valid project. A deploy command receives only a deployable project, and the entry point skips it with a log line for any other project type. The config path comes from `PIPELINE_CONFIG_FILE`. Running the CLI with no command lists the commands.
- **Command to environment.** Commands read their settings from environment variables that the workflow sets. A missing required variable stops the command with an error that names it, before any external call.
- **Config to the rest.** Loading returns a fully validated, typed config or throws one error that lists every problem found. Nothing downstream re-validates the file.
- **Domain.** Builders take the config, the environment and the organization settings, and return plain data: the Terraform configuration, one Wrangler configuration per Worker, resource names, summaries as markdown, and decisions such as whether to post a pull request comment.
- **Adapters.** Each adapter talks to one external system and returns owned types. A failed call throws with the status or exit code and the response body or stderr. The deploy target adapter composes the others.
- **Deploy target.** Every target implements one interface: contribute public env, ensure infrastructure, load backing env, deploy, migrate, tear down and plan. A registry maps the target name to its factory.
- **Job to job.** A job passes data to the next through GitHub step outputs. Public values go to `GITHUB_ENV`. Secrets travel only as masked step outputs.
- **The `./worker-types` export.** It takes a path to `nextnode.toml` and returns the type files it wrote. It reads no environment variable and writes no GitHub output, because it runs on developer machines.

## Commands

### plan

```mermaid
sequenceDiagram
    autonumber
    participant Job as plan job
    participant CLI
    participant Out as Step outputs
    Job->>CLI: plan with PIPELINE_CONFIG_FILE and PIPELINE_ENVIRONMENT
    CLI->>CLI: load and validate nextnode.toml
    alt invalid file
        CLI-->>Job: exit with every validation error
    end
    CLI->>CLI: build the quality task matrix
    CLI->>Out: project name, package directory, quality matrix and feature flags
```

The quality matrix holds the project's lint and test scripts, the D1 check command when one is declared, and the production gate. The gate runs in production when the development environment is enabled. It fails unless the development workflow succeeded for the same commit.

### provision

```mermaid
sequenceDiagram
    autonumber
    participant CLI
    participant HCP as HCP Terraform
    participant PS as PlanetScale
    participant TF as Terraform
    CLI->>CLI: resolve environment, organization settings and credentials
    CLI->>HCP: look up the workspace PROJECT-ENV
    alt workspace missing
        CLI->>HCP: create it in local execution mode
    else workspace in another execution mode
        Note over CLI,HCP: provision stops before any change
    end
    opt PlanetScale declared
        CLI->>PS: look up the database, create it if missing
        loop until ready or out of time
            CLI->>PS: poll readiness
        end
    end
    CLI->>TF: generate the configuration in a temporary directory, init, apply
    CLI->>TF: read outputs
    CLI->>CLI: merge env contributions, stop on a name collision
```

[HCP Terraform](hcp/terraform.md) and [PlanetScale](planetscale/database.md) explain why the workspace and the database are created outside Terraform.

### migrate-remote

```mermaid
sequenceDiagram
    autonumber
    participant CLI
    participant TF as Terraform
    participant WR as Wrangler
    participant Cmd as Project migrate command
    CLI->>TF: read outputs
    opt D1 declared
        CLI->>WR: apply pending D1 migrations remotely
    end
    opt PlanetScale declared
        CLI->>Cmd: run it with DATABASE_URL from the migrator role
    end
    CLI->>CLI: write one summary per migration
```

D1 migrations run against the generated configuration of the first Worker that binds D1. Wrangler applies only the migrations the remote database lacks, so the step runs on every deploy.

### deploy

```mermaid
sequenceDiagram
    autonumber
    participant CLI
    participant TF as Terraform
    participant WR as Wrangler
    participant Site as Worker hostname
    CLI->>TF: read outputs once
    CLI->>CLI: merge public env, backing env and project secrets
    CLI->>CLI: write public values to GITHUB_ENV
    loop each Worker, after the Workers it binds
        CLI->>CLI: build its Wrangler configuration
        CLI->>CLI: add the SEO guard outside production, delete source maps
        CLI->>WR: deploy with a temporary configuration file
        opt project secrets loaded and the Worker has a script
            CLI->>WR: list secret names, then set and delete in one bulk call
        end
    end
    loop each public routed Worker
        CLI->>Site: request the health path until it answers or retries run out
    end
```

### plan-infra

```mermaid
sequenceDiagram
    autonumber
    participant CLI
    participant TF as Terraform
    participant PR as Pull request
    CLI->>TF: generate, init, plan with a detailed exit code
    CLI->>CLI: write the plan to the step summary
    opt PIPELINE_PR_NUMBER is set
        CLI->>PR: find the comment carrying the project and environment marker
        alt comment exists
            CLI->>PR: replace its body
        else plan has changes
            CLI->>PR: post a new comment
        else no changes
            CLI->>CLI: post nothing
        end
    end
```

### teardown-guard and teardown

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant CLI
    participant TF as Terraform
    participant WR as Wrangler
    Op->>CLI: teardown-guard with TEARDOWN_CONFIRM
    Note over Op,CLI: stops unless the confirmation equals the project name
    Op->>CLI: teardown
    Note over Op,CLI: stops when a data-holding service is declared and TEARDOWN_WIPE_DATA is unset
    CLI->>TF: generate, init, plan
    CLI->>WR: delete each Worker script, a missing script counts as done
    CLI->>TF: destroy
```

Workers go first so no traffic reaches resources that Terraform is about to destroy.

### generate-worker-types

```mermaid
sequenceDiagram
    autonumber
    participant Dev as worker-types gen
    participant Lib as worker-types export
    participant FS as App package
    Dev->>Lib: path to nextnode.toml
    Lib->>Lib: load and validate the file
    loop each Worker with a script
        Lib->>Lib: build its Wrangler configuration with placeholder outputs
        Lib->>FS: write worker-configuration.d.ts beside the nearest package.json
    end
```

The CLI command of the same name does the same from CI. Type generation runs before provision, so the builders receive placeholder resource ids. Only binding and var names reach the type file.

The remaining commands belong to other workflows. `load-secrets` is described in [the Infisical vault](infisical/vault.md). `prod-gate`, `publish` and `publish-result` are described in [GitHub Actions](github/actions.md).

## A deploy run

```mermaid
stateDiagram-v2
    [*] --> Resolving
    Resolving --> Rolling: outputs read and env merged
    Resolving --> Stopped: output missing or env collision
    Rolling --> Rolling: next Worker deployed and synced
    Rolling --> Partial: a Worker deploy or secret sync fails
    Rolling --> Checking: every Worker deployed
    Checking --> Live: every public Worker healthy
    Checking --> Unhealthy: a health check never passes
    state "Stopped, no Worker touched" as Stopped
    state "Partial, earlier Workers run new code" as Partial
    state "Unhealthy, every Worker runs new code" as Unhealthy
```

## Failures and what they leave

| Failure                                                | What is left                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nextnode.toml` is invalid                             | Nothing ran. The error lists every problem.                                                                                                                  |
| A required variable or organization setting is missing | The command stopped before any external call.                                                                                                                |
| The HCP workspace is not in local execution mode       | Nothing applied. The workspace must be switched by hand.                                                                                                     |
| The PlanetScale database is not ready in time          | The database exists or is still being created. Terraform did not run. The next provision reuses it.                                                          |
| `terraform apply` fails                                | HCP state records what was created. The next run converges from there.                                                                                       |
| The Terraform state lock stays held                    | Terraform waited for a bounded time, then failed with a hint on how to release the lock.                                                                     |
| A migration fails                                      | Workers keep their previous version, because the deploy job needs a successful migrate job.                                                                  |
| A Worker's deploy or secret sync fails                 | Workers earlier in the order run the new code. That Worker and later ones keep what they had, except a failed sync leaves the new code with the old secrets. |
| A health check never passes                            | Every Worker runs the new code. The job is red.                                                                                                              |
| The repository has no Infisical project                | The deploy succeeds with a warning. Worker secrets stay as they were.                                                                                        |
| Teardown fails after deleting Workers                  | Workers are gone. Terraform resources remain until teardown runs again.                                                                                      |

## Guarantees

1. A scripted Worker holds exactly the secrets of its repository's Infisical environment after a deploy that loaded them. A static-assets-only Worker holds none.
2. No secret reaches `GITHUB_ENV`, a log line, a step summary, a subprocess argument or the build job.
3. The project's own code never runs in a job that can log in to the vault, except a PlanetScale migration command.
4. Terraform and Wrangler never manage the same resource.
5. The generated types and the deployed Wrangler configuration come from the same builders.
6. Generated configuration is deterministic for a given `nextnode.toml` and environment.
7. Generated Terraform and Wrangler files live in temporary directories that each command removes.
8. Development and production never share a resource, a Worker script or a rate limiter counter.
9. Terraform, Wrangler, GitHub CLI and migration subprocesses, the PlanetScale readiness poll and the health checks are bounded in time. Other calls rely on the job's timeout.
10. Teardown needs a typed confirmation, refuses to destroy data without `wipe_data`, and keeps the Terraform state history and the PlanetScale database.
