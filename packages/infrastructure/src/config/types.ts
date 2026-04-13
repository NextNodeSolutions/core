export interface NextNodeConfig {
	readonly project: ProjectSection
	readonly scripts: ScriptsSection
	readonly package: PackageSection | false
	readonly environment: EnvironmentSection
	readonly deploy: DeploySection | false
}

export const PROJECT_TYPES = ['app', 'package', 'static'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const DEPLOY_TARGETS = ['hetzner-vps', 'cloudflare-pages'] as const
export type DeployTargetType = (typeof DEPLOY_TARGETS)[number]

export interface HetznerDeployConfig {
	readonly serverType: string
	readonly location: string
}

export interface ProjectSection {
	readonly name: string
	readonly type: ProjectType
	readonly filter: string | false
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
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

export interface DeploySection {
	readonly target: DeployTargetType
	readonly secrets: ReadonlyArray<string>
	readonly hetzner: HetznerDeployConfig | undefined
}

export const DEFAULT_SCRIPTS: ScriptsSection = {
	lint: 'lint',
	test: 'test',
	build: 'build',
}

export const DEFAULT_ENVIRONMENT: EnvironmentSection = {
	development: true,
}

export type DeployableProjectType = 'app' | 'static'

export const DEPLOYABLE_PROJECT_TYPES: ReadonlySet<string> = new Set([
	'app',
	'static',
])

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
