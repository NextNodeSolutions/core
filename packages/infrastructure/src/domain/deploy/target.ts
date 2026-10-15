import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersResourceOutcome } from './resource-outcome.ts'
import type { TeardownResult } from './teardown-result.ts'

export type DeployInput = {
	// The secrets every Worker of the project holds after the deploy: the
	// repository's Infisical environment. Undefined when the repository has no
	// Infisical project, which leaves the Workers' secrets as they are.
	readonly secrets: Readonly<Record<string, string>> | undefined
}

export type DeployedWorker = { readonly name: string; readonly url: string }
export type WorkerDeployedEnvironment = {
	readonly kind: 'worker'
	readonly name: string
	readonly url: string
	readonly deployedAt: Date
	readonly workers: ReadonlyArray<DeployedWorker>
}
export type DeployedEnvironment = WorkerDeployedEnvironment
export type WorkersProvisionResult = {
	readonly kind: 'workers'
	readonly outcome: WorkersResourceOutcome
	readonly workspaceName: string
	readonly durationMs: number
}
export type ProvisionResult = WorkersProvisionResult
export type DeployResult = {
	readonly projectName: string
	readonly deployedEnvironments: ReadonlyArray<DeployedEnvironment>
	readonly durationMs: number
}
export type D1MigrateInput = {
	readonly kind: 'd1'
	readonly projectName: string
	readonly environment: AppEnvironment
}
export type PlanetscaleMigrateInput = {
	readonly kind: 'planetscale'
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly migrateCommand: string
}
export type MigrateInput = D1MigrateInput | PlanetscaleMigrateInput
export type MigrateResult = { readonly durationMs: number }
export const DEFAULT_MIGRATE_COMMAND = 'pnpm drizzle-kit migrate'

export interface DeployTarget {
	readonly name: string
	ensureInfra(projectName: string): Promise<ProvisionResult>
	deploy(projectName: string, input: DeployInput): Promise<DeployResult>
	runMigrate(input: MigrateInput): Promise<MigrateResult>
	teardown(projectName: string): Promise<TeardownResult>
	planDiff(): Promise<string>
}
