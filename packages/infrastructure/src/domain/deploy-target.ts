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

export interface ProjectDeployConfig {
	readonly projectName: string
	readonly image: ImageRef
	readonly environments: ReadonlyArray<EnvironmentDeployConfig>
	readonly composeFileContent: string
}

export interface DeployedEnvironment {
	readonly name: string
	readonly url: string
	readonly imageRef: ImageRef
	readonly deployedAt: Date
}

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
	ensureInfra(projectName: string): Promise<void>
	deploy(config: ProjectDeployConfig): Promise<DeployResult>
	describe(projectName: string): Promise<TargetState | null>
	teardown(projectName: string): Promise<void>
}
