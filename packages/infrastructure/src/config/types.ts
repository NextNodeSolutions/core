import type { ServicesConfig } from './service-config.ts'
import type {
	WorkerLimitsConfig,
	WorkerRateLimitConfig,
	WorkerRateLimiterConfig,
} from './worker-firewall.ts'

export interface NextNodeConfig {
	readonly project: ProjectSection
	readonly scripts: ScriptsSection
	readonly package: PackageSection | false
	readonly environment: EnvironmentSection
	readonly deploy: DeploySection | false
	readonly services: ServicesConfig
}

export interface CloudflareWorkersDeployableConfig extends NextNodeConfig {
	readonly project: ProjectSection & {
		readonly type: DeployableProjectType
		readonly domain: string
	}
	readonly deploy: CloudflareWorkersDeploySection
}

export type DeployableConfig = CloudflareWorkersDeployableConfig

const DEPLOYABLE_PROJECT_TYPES = ['app', 'static'] as const
export type DeployableProjectType = (typeof DEPLOYABLE_PROJECT_TYPES)[number]

const NON_DEPLOYABLE_PROJECT_TYPES = ['package'] as const
export type NonDeployableProjectType =
	(typeof NON_DEPLOYABLE_PROJECT_TYPES)[number]

export type ProjectType = DeployableProjectType | NonDeployableProjectType

export const PROJECT_TYPES = [
	...DEPLOYABLE_PROJECT_TYPES,
	...NON_DEPLOYABLE_PROJECT_TYPES,
] as const

export const DEPLOY_TARGETS = ['cloudflare-workers'] as const
export type DeployTargetType = (typeof DEPLOY_TARGETS)[number]
export const DEFAULT_WORKER_ENTRY = 'dist/server/entry.mjs'

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
export const CRON_METHODS = ['GET', 'POST'] as const
export type CronMethod = (typeof CRON_METHODS)[number]
export const DEFAULT_CRON_METHOD: CronMethod = 'POST'
export interface CronJobConfig {
	readonly name: string
	readonly schedule: string
	readonly path: string
	readonly method: CronMethod
	readonly service?: string
}

export interface WorkerServiceConfig {
	readonly url?: string
	// Behind Cloudflare Access. Resolved at parse time: the service's own
	// `internal`, else `project.internal`, and always false without a `url`.
	readonly internal: boolean
	readonly needs: ReadonlyArray<string>
	readonly dependsOn: ReadonlyArray<string>
	readonly entry: string | false
	readonly assets?: string
	readonly observability: boolean
	readonly rateLimit?: WorkerRateLimitConfig
	readonly publicPaths?: ReadonlyArray<string>
	readonly limits?: WorkerLimitsConfig
	readonly rateLimiters?: ReadonlyArray<WorkerRateLimiterConfig>
}

export interface CloudflareWorkersDeploySection {
	readonly target: 'cloudflare-workers'
	readonly services: Readonly<Record<string, WorkerServiceConfig>>
	readonly cron: ReadonlyArray<CronJobConfig>
}

export type DeploySection = CloudflareWorkersDeploySection

export const KEBAB_IDENTIFIER_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

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
	app: 'cloudflare-workers',
	static: 'cloudflare-workers',
}

export type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] }
