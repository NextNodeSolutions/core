# @nextnode-solutions/worker-types

Generate each Cloudflare Worker's `worker-configuration.d.ts` from `nextnode.toml`.

The generated file types `import { env } from 'cloudflare:workers'` (`Cloudflare.Env`)
and the `Env` interface from the project's declared bindings, vars and secrets —
the same `nextnode.toml` the deploy pipeline reads, so the types can never drift
from what is deployed.

## Usage

```jsonc
// package.json
{
	"devDependencies": {
		"@nextnode-solutions/worker-types": "^1.0.0",
	},
	"scripts": {
		"prebuild": "worker-types gen",
		"pretype-check": "worker-types gen",
	},
}
```

```gitignore
# generated, not committed
worker-configuration.d.ts

# local secrets, never committed - keep the pattern exact: a `.dev.vars*` glob
# would also swallow the generated .dev.vars.example, which IS committed
.dev.vars
```

`worker-types gen` reads `./nextnode.toml` (override with `--config <path>`), and
writes two files into each worker's package directory. A non-`cloudflare-workers`
project is a no-op.

## `.dev.vars.example`

Beside the types, each worker gets a `.dev.vars.example` listing every key it
will read from `env` once deployed — the injected vars (`SITE_URL`, each routed
peer's `<NAME>_URL`, the backing resource keys) plus its secret names, one
`KEY=""` per line, sorted. Bindings are absent: the local runtime provides those,
a `.dev.vars` never could.

Commit it — unlike `.dev.vars`, it carries no values, and it is how the next
developer discovers what to fill in. Which local channel to fill is yours to
pick: `.dev.vars`, or the `vars` block of a `wrangler.dev.jsonc`.

It is an example and nothing more: nothing checks that your actual `.dev.vars`
matches it, so a key you skip still surfaces as an `undefined` at runtime while
the generated types promise a `string`.

## Contributing: every generation change needs a commit here

The generation logic lives in `@nextnode-solutions/infrastructure` and is inlined
into this package's published bundle (it is a devDependency, and `tsdown`
declares no `external`). Consumers install only this package.

The release pipeline for it triggers on, and analyses, commits touching
`packages/worker-types/` **only**. So a change written entirely inside
`packages/infrastructure/` publishes the infrastructure package and never this
one, and consumers keep the stale generator indefinitely.

Therefore: any change to the generation logic must ship with a commit that
touches `packages/worker-types/` — extending `src/generate.test.ts` to cover the
new behaviour is the natural one. That test also runs the generation end-to-end
against a fixture project, though it resolves the workspace package, not the
published artifact: it does not prove the bundle re-inlined anything.
