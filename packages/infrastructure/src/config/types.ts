export interface NextNodeConfig {
	readonly project: ProjectSection
	readonly scripts: ScriptsSection
	readonly package: PackageSection | false
	readonly environment: EnvironmentSection
	readonly deploy: DeploySection | false
	readonly services: ServicesConfig
}

export interface HetznerDeployableConfig extends NextNodeConfig {
	readonly project: ProjectSection & {
		readonly type: DeployableProjectType
		readonly domain: string
	}
	readonly deploy: HetznerVpsDeploySection
}

export interface CloudflarePagesDeployableConfig extends NextNodeConfig {
	readonly project: ProjectSection & { readonly type: DeployableProjectType }
	readonly deploy: CloudflarePagesDeploySection
}

export type DeployableConfig =
	| HetznerDeployableConfig
	| CloudflarePagesDeployableConfig

export function isHetznerDeployableConfig(
	config: DeployableConfig,
): config is HetznerDeployableConfig {
	return config.deploy.target === 'hetzner-vps'
}

export function isCloudflarePagesDeployableConfig(
	config: DeployableConfig,
): config is CloudflarePagesDeployableConfig {
	return config.deploy.target === 'cloudflare-pages'
}

export const DEPLOYABLE_PROJECT_TYPES = ['app', 'static'] as const
export type DeployableProjectType = (typeof DEPLOYABLE_PROJECT_TYPES)[number]

export const NON_DEPLOYABLE_PROJECT_TYPES = ['package'] as const
export type NonDeployableProjectType =
	(typeof NON_DEPLOYABLE_PROJECT_TYPES)[number]

export type ProjectType = DeployableProjectType | NonDeployableProjectType

export const PROJECT_TYPES = [
	...DEPLOYABLE_PROJECT_TYPES,
	...NON_DEPLOYABLE_PROJECT_TYPES,
] as const

export const DEPLOY_TARGETS = ['hetzner-vps', 'cloudflare-pages'] as const
export type DeployTargetType = (typeof DEPLOY_TARGETS)[number]

export interface HetznerDeployConfig {
	readonly serverType: string
	readonly location: string
}

export const DEFAULT_HETZNER_CONFIG: HetznerDeployConfig = {
	serverType: 'cx23',
	location: 'nbg1',
}

export const DEFAULT_R2_STATE_BUCKET = 'nextnode-state'
export const DEFAULT_R2_CERTS_BUCKET = 'nextnode-certs'
export const R2_BUCKET_LOCATION_HINT = 'weur'

export interface ProjectSection {
	readonly name: string
	readonly type: ProjectType
	readonly filter: string | false
	readonly domain?: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly internal: boolean
}

export interface ScriptsSection {
	readonly lint: string | false
	readonly test: string | false
	readonly build: string | false
}

export interface PackageSection {
	readonly access: string
}

export interface EnvironmentSection {
	readonly development: boolean
}

// A named volume the deployable wants mounted at runtime. Currently only
// honored by the hetzner-vps target (mapped to a Docker named volume on the
// VPS local SSD); cloudflare-pages ignores the field.
export interface DeployVolume {
	readonly name: string
	readonly mount: string
}

// The generators a `[deploy].secrets` entry may declare. `token` draws from the
// base64url alphabet ([A-Za-z0-9_-]) - the right shape for JWT/HS256 signing
// keys; `password` draws from the alphanumeric alphabet ([A-Za-z0-9]) - the
// right shape for service/DB passwords that travel through URLs and shells.
export const SECRET_GENERATORS = ['token', 'password'] as const
export type SecretGenerator = (typeof SECRET_GENERATORS)[number]

// A secret the infra GENERATES itself (rather than requiring the operator to
// pre-set it in GitHub). Declared inline in `[deploy].secrets` as
// `{ name, generate, length }`. At provision the value is generated once and
// pushed as a GitHub env-secret, idempotently - see `ensureGeneratedSecrets`.
// `length` is the number of CHARACTERS in the produced secret.
export interface GeneratedSecretConfig {
	readonly name: string
	readonly generate: SecretGenerator
	readonly length: number
}

interface BaseDeploySection {
	// Override the VPS hostname this project deploys onto. When `null`, the
	// CLI resolves a shared default per environment (see resolveVpsName).
	// Only consumed by the hetzner-vps target; cloudflare-pages ignores it.
	readonly vps: string | null
	readonly volumes: ReadonlyArray<DeployVolume>
	// Secrets the infra auto-generates and pushes to GitHub at provision time -
	// the `{ name, generate, length }` entries parsed out of `[deploy].secrets`.
	// Empty when every declared secret is must-exist. Consumed by
	// `ensureGeneratedSecrets`; the names also live in `secrets` (the pull pool).
	readonly generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
}

export interface HetznerVpsDeploySection extends BaseDeploySection {
	readonly target: 'hetzner-vps'
	// The pool of GitHub Secret NAMES the pipeline pulls = the GLOBAL secrets
	// declared in `[deploy].secrets` (injected into every service) UNIONED with
	// every service's own `[deploy.services.<name>].secrets` (least-privilege).
	// Consumed by `pickSecrets` + the GITHUB_ENV write.
	readonly secrets: ReadonlyArray<string>
	readonly hetzner: HetznerDeployConfig
	// Per-service workloads declared under [deploy.services.<name>]. At least one
	// service is required; each entry declares how its image is obtained
	// (`build` | `upstream`), its port, and its runtime wiring.
	readonly services: Record<string, UserServiceConfig>
	// Scheduled HTTP jobs declared under [[deploy.cron]]. Each fires a request at
	// one of THIS project's services over the compose network on a cron schedule.
	// Rendered into the compose file as a single `cron` sidecar (both dev and
	// prod - each environment's stack runs its own, hitting its own app). Empty
	// when no job is declared.
	readonly cron: ReadonlyArray<CronJobConfig>
}

// HTTP methods a [[deploy.cron]] job may fire. Kept to the two BusyBox `wget`
// (the cron sidecar's client) actually implements - GET, and POST via
// `--post-data`. A job that needs PUT/DELETE belongs in app code, not a cron
// ping.
export const CRON_METHODS = ['GET', 'POST'] as const
export type CronMethod = (typeof CRON_METHODS)[number]

// POST is the default: a cron almost always TRIGGERS work (a mutation), and a
// GET endpoint risks being prefetched/cached by intermediaries.
export const DEFAULT_CRON_METHOD: CronMethod = 'POST'

// A single scheduled job declared under [[deploy.cron]]. `schedule` is a
// standard 5-field cron expression; `path` is an absolute request path hit on
// the target service INTERNALLY (`http://<service>:<port><path>`) - the dev
// never spells a host out, because the public URL is infra-generated. `service`
// names which [deploy.services.<name>] to hit; omitted = the primary (first
// declared) service.
export interface CronJobConfig {
	readonly name: string
	readonly schedule: string
	readonly path: string
	readonly method: CronMethod
	readonly service?: string
}

// The image-source discriminators a [deploy.services.<name>] entry may declare:
// `build` (built + pushed by the pipeline) or `upstream` (pulled verbatim from
// a `ref`).
export const DEPLOY_IMAGE_SOURCES = ['build', 'upstream'] as const
export type DeployImageSource = (typeof DEPLOY_IMAGE_SOURCES)[number]

// A single deployable workload declared under [deploy.services.<name>]. The
// instance name (the table key) is a KEBAB identifier; `source` discriminates
// how its image is obtained - `build` images are built + pushed by the pipeline
// (optional context/dockerfile/target; an omitted `target` builds the
// Dockerfile's final stage); `upstream` images are pulled verbatim from `ref`
// (with an optional registry-auth secret NAME).
export interface ServiceCommon {
	readonly port: number
	readonly url?: string
	readonly secrets: ReadonlyArray<string>
	// Backing services the workload needs at runtime (e.g. postgres). Reserved
	// for the multi-service wiring landing in M2 - parsed here, cross-validated
	// later.
	readonly needs: ReadonlyArray<string>
	// Sibling services this workload starts after (compose `depends_on`).
	readonly dependsOn: ReadonlyArray<string>
}

export interface BuildServiceConfig {
	readonly source: 'build'
	readonly context?: string
	readonly dockerfile?: string
	// Docker build STAGE to target (`--target`). Omitted builds the
	// Dockerfile's final stage - the default for a single-app image.
	readonly target?: string
	// NAMES of GitHub Variables to inject as build args (`--build-arg`) for this
	// service. Values never live in nextnode.toml - they are resolved against
	// the `ALL_VARS` payload at build time. Build-time-inlined config only
	// (e.g. `SITE_URL`, `R2_CDN_URL`); secrets NEVER flow through here (they
	// would bake into image layers) - they go through the runtime env_file.
	// Omitted when the service declares no build args.
	readonly buildArgs?: ReadonlyArray<string>
}

export interface UpstreamServiceConfig {
	readonly source: 'upstream'
	readonly ref: string
	readonly registryAuthSecret?: string
}

export type UserServiceConfig = ServiceCommon &
	(BuildServiceConfig | UpstreamServiceConfig)

export const DEFAULT_SERVICE_PORT = 3000

export interface CloudflarePagesDeploySection extends BaseDeploySection {
	readonly target: 'cloudflare-pages'
	// The pool of GitHub Secret NAMES synced to the Pages project. Declared
	// directly in `[deploy].secrets` - a Pages deploy is a single unit with no
	// per-service split, so there is nothing to derive and no leak to prevent.
	readonly secrets: ReadonlyArray<string>
}

export type DeploySection =
	| HetznerVpsDeploySection
	| CloudflarePagesDeploySection

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
export const SERVICE_NAMES = ['r2', 'postgres', 'observability'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceConfigByName {
	readonly r2: R2ServiceConfig
	readonly postgres: PostgresServiceConfig
	readonly observability: ObservabilityServiceConfig
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
}

export const KEBAB_IDENTIFIER_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function requiresInfraStorage(config: DeployableConfig): boolean {
	if (isHetznerDeployableConfig(config)) return true
	for (const name of SERVICE_NAMES) {
		if (
			config.services[name] !== undefined &&
			SERVICE_REQUIRES_INFRA_STORAGE[name]
		) {
			return true
		}
	}
	return false
}

export const DEFAULT_SCRIPTS: ScriptsSection = {
	lint: 'lint',
	test: 'test',
	build: 'build',
}

export const DEFAULT_ENVIRONMENT: EnvironmentSection = {
	development: true,
}

const DEPLOYABLE_SET: ReadonlySet<string> = new Set(DEPLOYABLE_PROJECT_TYPES)

export function isDeployable(type: ProjectType): type is DeployableProjectType {
	return DEPLOYABLE_SET.has(type)
}

export function isDeployableConfig(
	config: NextNodeConfig,
): config is DeployableConfig {
	return isDeployable(config.project.type)
}

export const DEFAULT_DEPLOY_TARGETS: Record<
	DeployableProjectType,
	DeployTargetType
> = {
	app: 'hetzner-vps',
	static: 'cloudflare-pages',
}

export type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] }

const PROJECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_TYPES)
const DEPLOY_TARGET_SET: ReadonlySet<string> = new Set(DEPLOY_TARGETS)
const POSTGRES_MODE_SET: ReadonlySet<string> = new Set(POSTGRES_MODES)
const SECRET_GENERATOR_SET: ReadonlySet<string> = new Set(SECRET_GENERATORS)

export function isPostgresMode(candidate: unknown): candidate is PostgresMode {
	return typeof candidate === 'string' && POSTGRES_MODE_SET.has(candidate)
}

export function isBoolean(candidate: unknown): candidate is boolean {
	return typeof candidate === 'boolean'
}

export function isProjectType(candidate: unknown): candidate is ProjectType {
	return typeof candidate === 'string' && PROJECT_TYPE_SET.has(candidate)
}

export function isScriptValue(candidate: unknown): candidate is string | false {
	return typeof candidate === 'string' || candidate === false
}

export function isDeployTarget(
	candidate: unknown,
): candidate is DeployTargetType {
	return typeof candidate === 'string' && DEPLOY_TARGET_SET.has(candidate)
}

export function isSecretGenerator(
	candidate: unknown,
): candidate is SecretGenerator {
	return typeof candidate === 'string' && SECRET_GENERATOR_SET.has(candidate)
}
