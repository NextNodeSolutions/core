export interface ImageRef {
	readonly registry: string
	readonly repository: string
	readonly tag: string
}

/**
 * Env vars that the deploy target owns and exposes to:
 *   1. The deployed runtime (via container .env or Pages env_vars)
 *   2. The CI pipeline (via GITHUB_ENV) so later steps can use them
 *
 * These are authoritative — features like mail/auth depend on them being
 * correct across every environment. Each Strategy MUST compute these
 * itself; no caller builds them by hand.
 *
 * Extend as config-as-code features land (SUPABASE_URL, INTERNAL_SITE_URL,
 * etc.). Treat additions as opt-in: keep new keys optional unless every
 * target can always produce them.
 */
export interface DeployEnv {
	readonly SITE_URL: string
	readonly [key: string]: string
}

export interface DeployInput {
	readonly secrets: Readonly<Record<string, string>>
	readonly image?: ImageRef
}

interface BaseDeployedEnvironment {
	readonly name: string
	readonly url: string
	readonly deployedAt: Date
}

export interface ContainerDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'container'
	readonly imageRef: ImageRef
}

export interface StaticDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'static'
}

export type DeployedEnvironment =
	| ContainerDeployedEnvironment
	| StaticDeployedEnvironment

export interface TargetState {
	readonly projectName: string
	readonly environments: ReadonlyArray<DeployedEnvironment>
}

export interface DeployResult {
	readonly projectName: string
	readonly deployedEnvironments: ReadonlyArray<DeployedEnvironment>
	readonly durationMs: number
}

export interface DeployTarget {
	readonly name: string
	computeDeployEnv(projectName: string): DeployEnv
	ensureInfra(projectName: string): Promise<void>
	reconcileDns(projectName: string, domain: string): Promise<void>
	deploy(projectName: string, input: DeployInput): Promise<DeployResult>
	describe?(projectName: string): Promise<TargetState | null>
}
