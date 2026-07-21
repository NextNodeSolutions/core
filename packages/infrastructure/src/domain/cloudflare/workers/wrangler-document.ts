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
 * whenever the service ships assets (the @astrojs/cloudflare `_worker.js/`
 * convention).
 */
export const WORKERS_ASSETS_BINDING = 'ASSETS'

/**
 * The D1 binding name. A cloudflare-workers project has a single D1 database
 * (materialised `<project>-<env>-d1`), bound as `env.DB` into every Worker that
 * declares `needs = ["d1"]`.
 */
export const WORKERS_D1_BINDING = 'DB'

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
	// Omitted for an internal worker (kept on wrangler's default); forced to
	// `false` for a Custom-Domain worker so it never also answers on workers.dev.
	readonly workers_dev?: boolean
	readonly routes?: ReadonlyArray<WranglerRoute>
	readonly assets?: WranglerAssets
	readonly vars?: Readonly<Record<string, string>>
	readonly d1_databases?: ReadonlyArray<WranglerD1Database>
	readonly kv_namespaces?: ReadonlyArray<WranglerKvNamespace>
	readonly r2_buckets?: ReadonlyArray<WranglerR2Bucket>
	readonly queues?: WranglerQueues
	readonly triggers?: WranglerTriggers
}
