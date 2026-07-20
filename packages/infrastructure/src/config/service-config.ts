import type { DeployTargetType } from './types.ts'

// drizzle-kit's own default `out` directory. Shared by [services.postgres] and
// [services.d1]: a project that does not override `migrations_folder` ships its
// generated SQL here, and `detect-migration-changes` diffs it verbatim.
export const DEFAULT_MIGRATIONS_FOLDER = 'drizzle'

export interface R2BucketConfig {
	// Bucket alias declared by the dev (kebab). Materialised as the real
	// Cloudflare bucket `<project>-<env>-<name>` via `computeR2BucketName`.
	readonly name: string
	// When true, the infra attaches a public custom domain
	// (`<name>.cdn.<domain>`) to the bucket and injects its URL as
	// `R2_BUCKET_<NAME>_URL`. Buckets default to private (cdn = false).
	readonly cdn: boolean
}

export interface R2ServiceConfig {
	readonly buckets: ReadonlyArray<R2BucketConfig>
}

// `[services.d1]` opts the cloudflare-workers project into a single D1 database,
// materialised as `<project>-<env>-d1` by the Terraform target and bound into
// every Worker that lists `needs = ["d1"]`. One DB per project - multiple would
// need per-service routing D1 does not warrant here.
export interface D1ServiceConfig {
	// Drizzle migrations folder relative to nextnode.toml. Defaults to
	// DEFAULT_MIGRATIONS_FOLDER so `wrangler d1 migrations apply` and
	// `detect-migration-changes` read the same directory as postgres does.
	readonly migrationsFolder: string
	// Shell command run on the GH runner during the quality stage to validate
	// the local migrations folder (no DB, pure filesystem check). Optional.
	readonly checkCommand?: string
}

// A single KV namespace declared under [[services.kv.namespaces]]. The alias
// (kebab) is materialised as `<project>-<env>-<name>` and bound as
// `KV_<ALIAS_SNAKE>` into every Worker that lists `needs = ["kv"]`.
export interface KvNamespaceConfig {
	readonly name: string
}

export interface KvServiceConfig {
	readonly namespaces: ReadonlyArray<KvNamespaceConfig>
}

// A single queue declared under [[services.queues]]. The alias (kebab) is
// materialised as `<project>-<env>-<name>` and bound as a producer
// `QUEUE_<ALIAS_SNAKE>` into every Worker that lists `needs = ["queues"]`.
export interface QueueConfig {
	readonly name: string
}

export interface QueuesServiceConfig {
	readonly queues: ReadonlyArray<QueueConfig>
}

export const POSTGRES_MODES = ['embedded', 'external'] as const
export type PostgresMode = (typeof POSTGRES_MODES)[number]

// `[services.observability]` opts the project into the self-hosted
// observability backend (VictoriaLogs + VictoriaMetrics + vmagent +
// vmalert + Alertmanager + blackbox_exporter) injected into the generated
// compose file. Declared once, by the monitoring project - the stack is
// itself a NextNode app deployed by the standard pipeline. Retentions are
// passed verbatim to the Victoria* `-retentionPeriod` flags; vhosts are
// the tailnet hostnames Caddy fronts VictoriaLogs (log ingestion +
// LogsQL) and vmui (ad-hoc metrics exploration) with.
export interface ObservabilityServiceConfig {
	// VictoriaLogs `-retentionPeriod` (e.g. "30d").
	readonly logsRetention: string
	// VictoriaMetrics `-retentionPeriod`, in months (e.g. 12).
	readonly metricsRetentionMonths: number
	// Tailnet vhost fronting VictoriaLogs - the URL NN_VL_URL points at.
	readonly logsVhost: string
	// Tailnet vhost fronting VictoriaMetrics/vmui.
	readonly metricsVhost: string
}

export interface PostgresServiceConfig {
	readonly mode: PostgresMode
	// Drizzle migrations folder relative to nextnode.toml. Defaults to
	// "drizzle" (drizzle-kit's own default `out` value) when omitted.
	readonly migrationsFolder?: string
	// Shell command run inside the ephemeral migrate container on the VPS.
	// Defaults to `pnpm drizzle-kit migrate` (platform-native runner that
	// reads `drizzle.config.ts` for dialect + `dbCredentials.url`, the app's
	// config picks up the injected `DATABASE_URL`). Override for non-Drizzle
	// stacks (e.g. `pnpm prisma migrate deploy`).
	readonly migrateCommand?: string
	// Shell command run on the GH runner during the quality stage to
	// validate the local migrations folder (no DB, pure filesystem check).
	// CLI default is `pnpm drizzle-kit check`; override for non-Drizzle
	// stacks (e.g. `pnpm prisma migrate diff --exit-code`).
	readonly checkCommand?: string
}

/**
 * Single source of truth for the set of supported backing services. Adding
 * a new service means appending its name here AND adding its config type
 * to `ServiceConfigByName` - TypeScript will then force every service-aware
 * site (validators, `hasAnyService`, future routers) to handle it.
 */
export const SERVICE_NAMES = [
	'r2',
	'postgres',
	'observability',
	'd1',
	'kv',
	'queues',
] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceConfigByName {
	readonly r2: R2ServiceConfig
	readonly postgres: PostgresServiceConfig
	readonly observability: ObservabilityServiceConfig
	readonly d1: D1ServiceConfig
	readonly kv: KvServiceConfig
	readonly queues: QueuesServiceConfig
}

export type ServicesConfig = {
	readonly [K in ServiceName]?: ServiceConfigByName[K]
}

/**
 * Per-service flag declaring whether opting into the service requires the
 * infra storage runtime (state + certs buckets) to be loaded. The mapped
 * type forces every entry in `SERVICE_NAMES` to set this flag - adding a
 * new service is a TypeScript error until it answers the question.
 */
export const SERVICE_REQUIRES_INFRA_STORAGE: {
	readonly [K in ServiceName]: boolean
} = {
	r2: true,
	postgres: true,
	// The observability stack provisions nothing outside the VPS compose
	// project itself - no buckets, no external state.
	observability: false,
	// D1/KV/Queues are realised by the cloudflare-workers Terraform target;
	// their state lives in the HCP Terraform workspace, not the R2 state bucket.
	d1: false,
	kv: false,
	queues: false,
}

/**
 * Which deploy targets can realise each backing service. A service declared
 * under a target absent from its list fails validation - there is no code path
 * to provision it there (D1/KV/Queues exist only on Cloudflare Workers;
 * postgres/observability only on a VPS; R2 spans both). The mapped type forces
 * every `SERVICE_NAMES` entry to answer the question, so a new service can never
 * silently accept an unsupported target.
 */
export const SERVICE_SUPPORTED_TARGETS: {
	readonly [K in ServiceName]: ReadonlyArray<DeployTargetType>
} = {
	r2: ['hetzner-vps', 'cloudflare-workers'],
	postgres: ['hetzner-vps'],
	observability: ['hetzner-vps'],
	d1: ['cloudflare-workers'],
	kv: ['cloudflare-workers'],
	queues: ['cloudflare-workers'],
}
