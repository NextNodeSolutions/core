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
	readonly domain: string | undefined
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

interface BaseDeploySection {
	readonly secrets: ReadonlyArray<string>
}

export interface HetznerVpsDeploySection extends BaseDeploySection {
	readonly target: 'hetzner-vps'
	readonly hetzner: HetznerDeployConfig
}

export interface CloudflarePagesDeploySection extends BaseDeploySection {
	readonly target: 'cloudflare-pages'
}

export type DeploySection =
	| HetznerVpsDeploySection
	| CloudflarePagesDeploySection

export interface R2ServiceConfig {
	readonly buckets: ReadonlyArray<string>
}

/**
 * Single source of truth for the set of supported backing services. Adding
 * a new service means appending its name here AND adding its config type
 * to `ServiceConfigByName` — TypeScript will then force every service-aware
 * site (validators, `hasAnyService`, future routers) to handle it.
 */
export const SERVICE_NAMES = ['r2'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceConfigByName {
	readonly r2: R2ServiceConfig
}

export type ServicesConfig = {
	readonly [K in ServiceName]?: ServiceConfigByName[K]
}

export const KEBAB_IDENTIFIER_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function requiresInfraStorage(config: DeployableConfig): boolean {
	return isHetznerDeployableConfig(config) || config.services.r2 !== undefined
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

export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

export function isProjectType(value: unknown): value is ProjectType {
	return typeof value === 'string' && PROJECT_TYPE_SET.has(value)
}

export function isScriptValue(value: unknown): value is string | false {
	return typeof value === 'string' || value === false
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDeployTarget(value: unknown): value is DeployTargetType {
	return typeof value === 'string' && DEPLOY_TARGET_SET.has(value)
}
