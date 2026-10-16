# @nextnode-solutions/worker-types

Generate each Cloudflare Worker's `worker-configuration.d.ts` from `nextnode.toml`.

The generated file types `import { env } from 'cloudflare:workers'` (`Cloudflare.Env`)
and the `Env` interface from the project's declared bindings and vars — the same
`nextnode.toml` the deploy pipeline reads, so the types can never drift from what
is deployed. Secrets come from the repository's Infisical project, not from
`nextnode.toml`: type the ones your code reads by augmenting `Cloudflare.Env` in
your own declaration file.

An internal service (`internal = true` on the service, or `project.internal`)
also gets `ACCESS_AUD`, the audience tag the deploy injects so the Worker can
verify the Cloudflare Access JWT.

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
```

`worker-types gen` reads `./nextnode.toml` (override with `--config <path>`), and
writes one `worker-configuration.d.ts` into each worker's package directory. A
non-`cloudflare-workers` project is a no-op.
