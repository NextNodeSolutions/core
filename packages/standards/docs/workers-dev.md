# Workers dev runtime — `nextnode-workers-dev`

Keeps local `wrangler dev` on the same Cloudflare Workers runtime the fleet
deploys, and refuses to start on a stale `workerd` rather than silently
floating to a compatibility date the installed runtime can't honour.

## Wiring a consumer

Any Cloudflare Workers app bundled by `wrangler` (e.g. a Hono API — not the
Astro fronts, which boot through `astro dev`):

```jsonc
// package.json
"scripts": {
  "dev": "nextnode-workers-dev src/index.ts --port 8787"
}
```

The bin forwards its arguments to `wrangler dev`, then appends
`--compatibility-date=<fleet date>` and `--compatibility-flags nodejs_compat`.
`wrangler` must be a devDependency of the consumer (the bin resolves it from
the project's own `node_modules` and fails loudly if absent). No committed
wrangler config, no generated file, no CI step.

On a `workerd` older than the fleet date it exits non-zero pointing at
`pnpm update wrangler`; otherwise it execs `wrangler dev`.

## Single source of truth

`WORKERS_COMPATIBILITY_DATE` (exported from `@nextnode-solutions/standards/workers`)
pins the local dev runtime. It MUST equal `DEFAULT_WORKERS_COMPATIBILITY_DATE`
in `@nextnode-solutions/infrastructure` (the deploy-time pin);
`compatibility-drift.test.ts` in that package fails the build if they diverge.

Bumping the fleet date: edit the constant in
`src/workers/compatibility.js`, match infrastructure's constant, and run
`pnpm update wrangler` across the fleet.
