import { cloudflareWorkers } from './cloudflare-workers.ts'

import type {
	DeploySection,
	DeployTargetType,
	GeneratedSecretConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'

export interface DeployProviderResult {
	readonly errors: string[]
	readonly deploy: DeploySection | undefined
}
export interface ParsedDeployInputs {
	readonly secrets: ReadonlyArray<string>
	readonly generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
	readonly workerServices: Record<string, WorkerServiceConfig>
	readonly domain: string | undefined
}

export interface DeployProviderValidator {
	readonly requiresDomain: boolean
	readonly requiresServices: boolean
	validate(
		deployRecord: Record<string, unknown>,
		inputs: ParsedDeployInputs,
	): DeployProviderResult
}

export const DEPLOY_PROVIDER_VALIDATORS: Record<
	DeployTargetType,
	DeployProviderValidator
> = {
	'cloudflare-workers': cloudflareWorkers,
}
