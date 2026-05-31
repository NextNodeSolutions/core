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

interface BaseDeploySection {
	readonly secrets: ReadonlyArray<string>
	// Override the VPS hostname this project deploys onto. When `null`, the
	// CLI resolves a shared default per environment (see resolveVpsName).
	// Only consumed by the hetzner-vps target; cloudflare-pages ignores it.
	readonly vps: string | null
	readonly volumes: ReadonlyArray<DeployVolume>
}

export interface HetznerVpsDeploySection extends BaseDeploySection {
	readonly target: 'hetzner-vps'
	readonly hetzner: HetznerDeployConfig
	readonly image: DeployImageConfig
	// Per-service workloads declared under [deploy.services.<name>]. During the
	// M1 migration this is populated either from the explicit sub-tables or, when
	// none are declared, synthesized as { app: … } from the legacy `image` field
	// so every downstream consumer can already read `services`. `image` is
	// dropped once every consumer reads `services` (M1.A-05).
	readonly services: Record<string, UserServiceConfig>
}

export const DEPLOY_IMAGE_SOURCES = ['build', 'upstream'] as const
export type DeployImageSource = (typeof DEPLOY_IMAGE_SOURCES)[number]

// `registryAuthSecret` is the NAME of a GitHub secret whose value holds the
// registry token used to `docker login` before pulling. Optional: omitted
// for public upstream images. Build images always log in to GHCR with the
// workflow's GITHUB_TOKEN, so this field is upstream-only.
export type DeployImageConfig =
	| { readonly source: 'build' }
	| {
			readonly source: 'upstream'
			readonly ref: string
			readonly registryAuthSecret?: string
	  }

export const DEFAULT_DEPLOY_IMAGE: DeployImageConfig = { source: 'build' }

const DEPLOY_IMAGE_SOURCE_SET: ReadonlySet<string> = new Set(
	DEPLOY_IMAGE_SOURCES,
)

export function isDeployImageSource(
	value: unknown,
): value is DeployImageSource {
	return typeof value === 'string' && DEPLOY_IMAGE_SOURCE_SET.has(value)
}

// A single deployable workload declared under [deploy.services.<name>]. The
// instance name (the table key) is a KEBAB identifier; `source` discriminates
// how its image is obtained — `build` images are built + pushed by the pipeline
// (optional context/dockerfile, `target` defaulting to the service name);
// `upstream` images are pulled verbatim from `ref` (with an optional
// registry-auth secret NAME, same contract as DeployImageConfig).
export interface ServiceCommon {
	readonly port: number
	readonly url?: string
	readonly secrets: ReadonlyArray<string>
	// Backing services the workload needs at runtime (e.g. postgres). Reserved
	// for the multi-service wiring landing in M2 — parsed here, cross-validated
	// later.
	readonly needs: ReadonlyArray<string>
	// Sibling services this workload starts after (compose `depends_on`).
	readonly dependsOn: ReadonlyArray<string>
}

export interface BuildServiceConfig {
	readonly source: 'build'
	readonly context?: string
	readonly dockerfile?: string
	readonly target: string
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
}

export type DeploySection =
	| HetznerVpsDeploySection
	| CloudflarePagesDeploySection

export interface R2ServiceConfig {
	readonly buckets: ReadonlyArray<string>
}

export const POSTGRES_MODES = ['embedded', 'external'] as const
export type PostgresMode = (typeof POSTGRES_MODES)[number]

// `[services.supabase]` is a declarative gate — the presence of the
// table opts the project into the full Supabase stack + R2 backups
// alias. No fields needed today; future knobs land here when there is
// an actual decision to expose.
export type SupabaseServiceConfig = Readonly<Record<string, never>>

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
 * to `ServiceConfigByName` — TypeScript will then force every service-aware
 * site (validators, `hasAnyService`, future routers) to handle it.
 */
export const SERVICE_NAMES = ['r2', 'postgres', 'supabase'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceConfigByName {
	readonly r2: R2ServiceConfig
	readonly postgres: PostgresServiceConfig
	readonly supabase: SupabaseServiceConfig
}

export type ServicesConfig = {
	readonly [K in ServiceName]?: ServiceConfigByName[K]
}

/**
 * Per-service flag declaring whether opting into the service requires the
 * infra storage runtime (state + certs buckets) to be loaded. The mapped
 * type forces every entry in `SERVICE_NAMES` to set this flag — adding a
 * new service is a TypeScript error until it answers the question.
 */
export const SERVICE_REQUIRES_INFRA_STORAGE: {
	readonly [K in ServiceName]: boolean
} = {
	r2: true,
	postgres: true,
	supabase: true,
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

export function isPostgresMode(value: unknown): value is PostgresMode {
	return typeof value === 'string' && POSTGRES_MODE_SET.has(value)
}

export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

export function isProjectType(value: unknown): value is ProjectType {
	return typeof value === 'string' && PROJECT_TYPE_SET.has(value)
}

export function isScriptValue(value: unknown): value is string | false {
	return typeof value === 'string' || value === false
}

export function isDeployTarget(value: unknown): value is DeployTargetType {
	return typeof value === 'string' && DEPLOY_TARGET_SET.has(value)
}
