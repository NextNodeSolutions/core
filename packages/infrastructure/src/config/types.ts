import {
	SERVICE_NAMES,
	SERVICE_REQUIRES_INFRA_STORAGE,
} from './service-config.ts'

import type { ServicesConfig } from './service-config.ts'

export * from './service-config.ts'

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

export interface CloudflareWorkersDeployableConfig extends NextNodeConfig {
	readonly project: ProjectSection & {
		readonly type: DeployableProjectType
		readonly domain: string
	}
	readonly deploy: CloudflareWorkersDeploySection
}

export type DeployableConfig =
	| HetznerDeployableConfig
	| CloudflarePagesDeployableConfig
	| CloudflareWorkersDeployableConfig

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

export function isCloudflareWorkersDeployableConfig(
	config: DeployableConfig,
): config is CloudflareWorkersDeployableConfig {
	return config.deploy.target === 'cloudflare-workers'
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

export const DEPLOY_TARGETS = [
	'hetzner-vps',
	'cloudflare-pages',
	'cloudflare-workers',
] as const
export type DeployTargetType = (typeof DEPLOY_TARGETS)[number]

// Default `main` for a generated wrangler config: the entry @astrojs/cloudflare
// v14 (the only major compatible with astro 7) emits, `dist/server/entry.mjs`,
// with its twin static-assets directory at `dist/client`. Overridable per
// service through the workers service schema.
export const DEFAULT_WORKER_ENTRY = 'dist/server/entry.mjs'

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

// A single Worker declared under [deploy.services.<name>] for the
// cloudflare-workers target. A Worker is not a container - no port, image
// source, or build args - so the shape is the runtime-wiring subset plus the
// bundle `entry` wrangler deploys. The strict field-level validation (rejecting
// container-only fields, custom entry/cron) lands in US-1.2.
export interface WorkerServiceConfig {
	readonly url?: string
	readonly secrets: ReadonlyArray<string>
	readonly needs: ReadonlyArray<string>
	readonly dependsOn: ReadonlyArray<string>
	readonly entry: string
}

export interface CloudflareWorkersDeploySection extends BaseDeploySection {
	readonly target: 'cloudflare-workers'
	readonly secrets: ReadonlyArray<string>
	readonly services: Readonly<Record<string, WorkerServiceConfig>>
	readonly cron: ReadonlyArray<CronJobConfig>
}

export type DeploySection =
	| HetznerVpsDeploySection
	| CloudflarePagesDeploySection
	| CloudflareWorkersDeploySection

export const KEBAB_IDENTIFIER_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function requiresInfraStorage(config: DeployableConfig): boolean {
	if (isHetznerDeployableConfig(config)) return true
	for (const name of SERVICE_NAMES) {
		if (config.services[name] && SERVICE_REQUIRES_INFRA_STORAGE[name]) {
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
