# AGENTS.md

This package holds the presets that every NextNode project extends and the `nextnode` oxlint plugin. These rules add to the [root AGENTS.md](../../AGENTS.md). [README.md](README.md) and the [architecture guide](docs/architecture.md) explain how it works.

## Invariants

- **Ship every preset as a file a project loads without building, and every JavaScript preset as ESM.** Projects import presets straight from `node_modules`, where Node refuses to strip TypeScript types.
- **Point every `exports` subpath at a file inside the source directory.** The `files` field publishes only that directory and the README, so anything else is missing on npm.
- **Keep the lint preset the only place that sets a severity.** Rule modules detect and report. Projects override severities in their own config, which works only when one place sets the default.
- **Give custom rules no options, and keep each threshold or word list as a named constant in the rule module.** Every project then gets the same standard and can only change the severity.
- **Keep custom rules syntactic.** They read the AST, scopes and source text, so they run in every project, with or without `--type-aware`. A check that needs types is a native `typescript/` rule.
- **Keep imports one way, from the lint preset to the registry, to rule modules, to shared helpers in the plugin directory.** A rule that imports another rule or the registry can no longer be read on its own.
- **Never let one preset import another.** Projects pick presets one by one.
- **Never let a rule fire on code written to the guidelines.** The non-functional suite lints such code and expects no diagnostic, not even a warning, because a rule that punishes compliant code teaches developers to disable it.

## Traps

- **Edit the formatter preset's TypeScript source, never its JavaScript copy, then run `build`.** The export serves the copy, while this package's own formatter config reads the source. A skipped build leaves the package formatting correctly and every consumer formatting with the old options. Git tracks the copy, so commit both.
- **Expect an enabled but unregistered `nextnode/` rule to break linting everywhere.** oxlint refuses the whole config, and every monorepo package lints nothing until the registry maps the rule.
- **Expect a registered rule without a severity in the lint preset to stay silent.** oxlint runs a plugin rule only when the config enables it by name.
- **Write any character that this package's own rules ban as a `\u` escape, in rule modules and fixtures alike.** The package lints itself with its own preset, so a raw em dash or curly quote in a sample fails `lint`.
- **Use the diagnostic code oxlint prints in a fixture case, never the config key.** The two differ for most native plugins. Copy the prefix from a case of the same plugin, or read the `code` field of `oxlint --format json` output.
- **Give a fixture case its own sample file names when its rule already has a case, when the rule reads the file name, or when an override glob must match.** Default names derive from the diagnostic code, so two cases of one rule overwrite each other's samples, and an override would not apply to the default name.
- **Test rules only by linting samples through the lint preset.** A test that imports a rule module skips registration and severity, which are the parts that break.
- **In a rule case, assert only on that case's rule.** Other rules may fire on the same sample. Only the non-functional suite asserts that a whole module stays clean.
- **Run the tests locally before pushing.** This package's `nextnode.toml` decides which scripts CI runs, so CI may not run the suite.
- **Keep the package's own `.lintstagedrc.js`.** lint-staged uses the nearest config and runs its commands from that directory, so staged files here are linted with this package's own oxlint config, which allows default exports in the source.

## Conventions

- **Name a rule module after its rule id in kebab-case, export the rule object as a named camelCase constant, and register it under the same id.** The id, the file and the registry key then always match.
- **Name rule ids the ESLint way.** Use `no-THING` for a ban, `prefer-THING` for a preference, `max-THING` for a limit, and a short statement of the requirement otherwise.
- **Open every rule module with a block comment that states the guideline, the reason, the exemptions and any sanctioned opt-out.** That comment is the rule's only documentation.
- **Write every message as the fix, and report through a message id with `data`.** Developers and agents act on the message without opening the rule, and message ids keep every text in `meta`, where a reader finds them together.
- **Scan raw text through the shared scanner when a rule must see comments and strings, with a fresh global regular expression per call.** A global expression keeps its position between calls.
- **Put a helper in the rule module when one rule uses it, and in the plugin directory when several do.** Rules then share code without importing each other.
- **Comment a lint preset entry whose severity or `off` is a judgment call.** The next maintainer otherwise reverts it.
- **Comment each fixture case with the guideline it enforces, and each edge sample with what makes it tricky.** The case is the rule's executable specification, and the comment ties it back to the guideline.
- **Put each tool's presets in a directory named after the tool. Name the file `base` when the tool has one preset, and after the project kind when it has several, with the prefix its siblings use.** Export subpaths follow the same shape, `./TOOL` or `./TOOL/KIND`.
- **Default-export the config from every preset module.** Tools read config files through their default export, and this package's lint config allows default exports in the source for that reason.
- **Give every JavaScript preset that projects import from a TypeScript config a declaration file beside it, typed with the upstream tool's config type.** Projects spread or merge these objects, so the declared shape is the contract.

## Extending

### Add a custom rule

1. Check the oxlint rule list first, and configure a native rule when one covers the check. The plugin exists only for what native rules cannot do.
2. Write the rule module in the plugin's rule directory, with the header comment, `meta` and `create`.
3. Register it in the plugin registry.
4. Enable it in the lint preset under `nextnode/`, next to the other custom rules.
5. Exempt file types through the preset's overrides when needed.
6. Add a case to the custom-rule fixtures with a bad, an edge and a good sample.
7. Verify the package, then the monorepo.

### Add a native rule setting

1. Add its plugin to the lint preset's plugin list when the plugin is missing.
2. Add the rule to the lint preset's rules, near related entries, with its options. A category may already enable it, and the explicit entry then sets its severity or options.
3. Add a case to the native-rule fixtures.
4. Verify the package, then the monorepo.

### Add a type-aware rule

1. Add the `typescript/` rule to the type-aware block of the lint preset's rules.
2. Add a case to the type-aware fixtures. The harness writes a strict tsconfig beside the samples, so they may rely on strict types.
3. Verify the package, then the monorepo. Packages that lint with `--type-aware` pick the rule up.

### Change a file-type override

1. Add the rule or the glob to the override block whose reason matches.
2. Create a new block only for a new reason, and state the reason in a comment.
3. Prove it with a fixture case whose sample file name matches the glob.
4. Verify the package.

### Change a preset

1. Edit the preset. For the formatter, edit the TypeScript source and run `build`.
2. Update its declaration file when the exported shape changes.
3. Update the matching section of the [configuration guide](docs/configuration.md) when the way a project wires the preset changes.
4. Verify the package, then the monorepo.

### Add a preset

1. Add the preset file to the tool's directory, or create a directory for a new tool, named as the conventions above say.
2. Add a declaration file when projects import it from a TypeScript config.
3. Add the export subpath to `exports`, shaped like its siblings. Use an object with `types` and `default` when a declaration exists, and a plain path otherwise.
4. For a new tool, add it to `peerDependencies`, mark it optional in `peerDependenciesMeta` unless every project needs it, and add it to `devDependencies` when this package uses it on itself.
5. Add a section with a project-side snippet to the [configuration guide](docs/configuration.md).
6. Verify the package.

## Verifying

Run from the repository root:

```sh
pnpm --filter @nextnode-solutions/standards build
pnpm --filter @nextnode-solutions/standards test
pnpm --filter @nextnode-solutions/standards lint
pnpm --filter @nextnode-solutions/standards format:check
```

`lint` must report no error. Read its warnings for findings your change added. Every monorepo package lints, formats and tests with this package's presets, so after any change to a preset or a rule, also run the root checks listed in the [root AGENTS.md](../../AGENTS.md#checks) and fix or justify each new finding.
