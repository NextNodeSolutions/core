/**
 * The Cloudflare Workers runtime version every generated config pins. A fixed
 * date freezes the workerd behaviour set so a deploy is reproducible run to run;
 * bumping it is a deliberate, reviewed change - never a floating value. Held
 * centrally by the infra (the dev never spells it in nextnode.toml).
 */
export const DEFAULT_WORKERS_COMPATIBILITY_DATE = '2026-06-01'

/**
 * The compatibility flags every generated config carries. `nodejs_compat`
 * unlocks the Node built-ins @astrojs/cloudflare and common libraries reach for
 * on workerd. A named constant so every service gets the identical flag set and
 * a change is one edit.
 */
export const WORKERS_COMPATIBILITY_FLAGS = ['nodejs_compat'] as const

/**
 * The binding a Worker reads its static-asset fetcher under (`env.ASSETS`). Set
 * whenever the service ships assets (the @astrojs/cloudflare `server`/`client`
 * convention, or the historic `_worker.js/` one).
 */
export const WORKERS_ASSETS_BINDING = 'ASSETS'

/**
 * The D1 binding name. A cloudflare-workers project has a single D1 database
 * (materialised `<project>-<env>-d1`), bound as `env.DB` into every Worker that
 * declares `needs = ["d1"]`.
 */
export const WORKERS_D1_BINDING = 'DB'

/**
 * Turn a service or resource alias into the `env.<KEY>` binding name every
 * generated config uses: uppercase, dashes to underscores (`admin-api` ->
 * `ADMIN_API`). Shared by KV/R2/Queue backing bindings and worker-to-worker
 * service bindings so a single rule governs every `env` key a Worker reads.
 */
export function toBindingName(alias: string): string {
	return alias.toUpperCase().replaceAll('-', '_')
}

/**
 * The Hyperdrive binding name. A cloudflare-workers project with
 * `[services.planetscale]` gets a single Hyperdrive config (pooling + query
 * cache in front of the provisioned Postgres), bound as `env.HYPERDRIVE` into
 * every Worker that declares `needs = ["planetscale"]`. The Worker connects
 * through the binding's `connectionString`; the origin credentials live only in
 * Terraform state, never in the Worker's env.
 */
export const WORKERS_HYPERDRIVE_BINDING = 'HYPERDRIVE'

// A worker Custom Domain route: `custom_domain: true` distinguishes it from a
// zone route (a wildcard pattern). The pattern is the resolved hostname the
// Worker answers on.
export interface WranglerRoute {
	readonly pattern: string
	readonly custom_domain: true
}

// Static assets served alongside the Worker. `directory` is the folder of built
// files; `binding` exposes the asset fetcher to Worker code.
export interface WranglerAssets {
	readonly directory: string
	readonly binding: string
}

export interface WranglerD1Database {
	readonly binding: string
	readonly database_name: string
	readonly database_id: string
	readonly migrations_dir?: string
}

export interface WranglerKvNamespace {
	readonly binding: string
	readonly id: string
}

export interface WranglerR2Bucket {
	readonly binding: string
	readonly bucket_name: string
}

export interface WranglerQueueProducer {
	readonly binding: string
	readonly queue: string
}

// A worker-to-worker service binding: `env.<binding>` exposes a `Fetcher` that
// invokes the target Worker directly on Cloudflare's edge (no DNS, no TLS, no
// public hostname) - the ONLY channel a Worker reaches another Worker on.
// `service` is the target's deployed script name (`<project>-<env>-<name>`), so
// the binding resolves to the exact script wrangler deploys and teardown deletes.
export interface WranglerServiceBinding {
	readonly binding: string
	readonly service: string
}

// A Hyperdrive binding: `binding` is the env var name the Worker reads
// (`env.HYPERDRIVE`), `id` is the `cloudflare_hyperdrive_config` UUID Terraform
// emitted. No connection string travels here - the origin credentials are held
// by the Hyperdrive config in Terraform state.
export interface WranglerHyperdrive {
	readonly binding: string
	readonly id: string
}

export interface WranglerQueues {
	readonly producers: ReadonlyArray<WranglerQueueProducer>
}

export interface WranglerTriggers {
	readonly crons: ReadonlyArray<string>
}

/**
 * The wrangler configuration document (JSON) generated per service and written
 * to an ephemeral file for `wrangler deploy --config`. Optional keys are omitted
 * when empty so a generated config stays minimal (no `routes: []` on an internal
 * worker, no `vars: {}` before US-3.2 fills them). Field shapes mirror the
 * wrangler v4 schema verbatim so wrangler consumes it without translation.
 */
export interface WranglerDocument {
	readonly name: string
	readonly main: string
	readonly compatibility_date: string
	readonly compatibility_flags: ReadonlyArray<string>
	// Always emitted `false`: no worker (routed or internal) may answer on
	// `<name>.workers.dev`. A routed worker reaches users on its Custom Domain; an
	// internal worker is reachable only through service bindings.
	readonly workers_dev?: boolean
	readonly routes?: ReadonlyArray<WranglerRoute>
	readonly assets?: WranglerAssets
	readonly vars?: Readonly<Record<string, string>>
	readonly services?: ReadonlyArray<WranglerServiceBinding>
	readonly d1_databases?: ReadonlyArray<WranglerD1Database>
	readonly kv_namespaces?: ReadonlyArray<WranglerKvNamespace>
	readonly r2_buckets?: ReadonlyArray<WranglerR2Bucket>
	readonly hyperdrive?: ReadonlyArray<WranglerHyperdrive>
	readonly queues?: WranglerQueues
	readonly triggers?: WranglerTriggers
}
