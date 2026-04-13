export interface ImageRef {
	readonly registry: string
	readonly repository: string
	readonly tag: string
}

export interface EnvironmentDeployConfig {
	readonly name: string
	readonly hostname: string
	readonly envVars: Readonly<Record<string, string>>
	readonly secrets: Readonly<Record<string, string>>
}

export interface ContainerDeployConfig {
	readonly kind: 'container'
	readonly projectName: string
	readonly image: ImageRef
	readonly environments: ReadonlyArray<EnvironmentDeployConfig>
}

export interface StaticDeployConfig {
	readonly kind: 'static'
	readonly projectName: string
	readonly environments: ReadonlyArray<EnvironmentDeployConfig>
}

export type ProjectDeployConfig = ContainerDeployConfig | StaticDeployConfig

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

export interface DeployTarget<
	TConfig extends ProjectDeployConfig = ProjectDeployConfig,
> {
	readonly name: string
	ensureInfra(projectName: string): Promise<void>
	deploy(config: TConfig): Promise<DeployResult>
	describe?(projectName: string): Promise<TargetState | null>
}
