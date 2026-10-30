# worker-types

This package is the published command-line shell around the Worker type generation that lives in the infrastructure package. Read [README.md](README.md) for what the command does, and the [root AGENTS.md](../../AGENTS.md) for the monorepo rules.

## Where a change goes

- **Change the generated file in the infrastructure package, never here.** The renderer reads the same Wrangler document the deploy builds, so the types and the deploy stay in sync only while one package produces both. That covers the members and their types, the header, the file name, where it is written and which Workers get one. Follow the [infrastructure AGENTS.md](../infrastructure/AGENTS.md) there.
- **Find the spot in infrastructure by role.** What a binding is typed as lives in the Env renderer in its Workers `domain`. Where the file lands lives in the types writer in its Workers `adapters`. Config loading and the choice of Workers live in the generation entry behind the `@nextnode-solutions/infrastructure/worker-types` export. A new public var needs no change at all, because the renderer types every var of the Wrangler document as a `string`.
- **Change only the command surface and the packaging here.** That is argument parsing, the usage line, the summary log, the exit code, the bin, the published files, the dependencies and the tsdown config. Everything else is generation logic.
- **Keep the command in one module.** Code that would need a second module is generation logic, and it belongs in infrastructure where the deploy can share it.
- **Add a flag in the `parseArgs` options and in the usage line together.** The usage line is the only help the command prints, on an unknown command. When the flag changes generation, add the parameter to the function behind the infrastructure export first, then pass the value through.

## Packaging

- **Import infrastructure only through its `@nextnode-solutions/infrastructure/worker-types` export.** That export is a separate build entry of infrastructure. Its internal `#/` imports are not exported and do not resolve from here. When the command needs another function, export it from the generation entry first.
- **Keep `@nextnode-solutions/infrastructure` in `devDependencies`.** tsdown inlines devDependencies into the bundle. Infrastructure is never published to npm, so a runtime dependency on it would break every install.
- **Keep every third-party package the inlined code imports at runtime in `dependencies`, `valibot` and `smol-toml` included.** tsdown keeps `dependencies` external, so the bundle imports them at runtime and npm must install them with the command. This package's own source never imports them, which makes them look unused. Keep their ranges compatible with infrastructure's, because the inlined code was type-checked against infrastructure's copies.
- **Build through turbo, never with the bare `build` script on a checkout where infrastructure is not built.** The infrastructure export resolves to infrastructure's build output. Without it, tsdown logs an `UNRESOLVED_IMPORT` warning, keeps a runtime import of the unpublished infrastructure package and still exits 0.

## Failures

- **Fail by throwing an `Error` with a readable message, and leave the exit to the single top-level handler.** Apps run the command as a pre-script. The handler logs the message through `@nextnode-solutions/logger` and exits with code 1, which stops their build.
- **Never declare secrets in the generated types.** Secrets live in the repository's Infisical project and `nextnode.toml` names none. The app types them by augmenting `Cloudflare.Env`.

## Releasing

- **Release an infrastructure-side change with a `feat(worker-types)` or `fix(worker-types)` commit that touches this package, usually the README section the change affects.** The release counts only commits under this package's directory, and the package's release workflow runs only on that path. An infrastructure commit alone never reaches the apps.

## Checks

Run from this package's directory:

```bash
pnpm type-check
pnpm lint
pnpm turbo run build
grep -rl '@nextnode-solutions/infrastructure' dist
```

Type-checking does not need infrastructure built, because the export's types point at infrastructure's source. `pnpm turbo run build` builds infrastructure first. The `grep` must print nothing. A match means the bundle still imports infrastructure instead of carrying it.

- **Prove a change to the generated file on a scratch project outside the repository.** The package has no test suite, and its `nextnode.toml` turns the test task off. The scratch project needs a `nextnode.toml` with a Worker under `[deploy.services]` and a `package.json` above that Worker's `entry`. Run the bundle against it and read the file it writes:

```bash
node dist/index.js gen --config /ABSOLUTE/PATH/TO/nextnode.toml
```
