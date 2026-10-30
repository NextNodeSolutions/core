import { cloudflareWorkers } from './cloudflare-workers.ts'

import type {
	DeployServiceConfig,
	DeploySection,
	DeployTargetType,
} from '#/config/types.ts'

export interface DeployProviderResult {
	readonly errors: string[]
	readonly deploy: DeploySection | undefined
}
export interface ParsedDeployInputs {
	readonly workerServices: Record<string, DeployServiceConfig>
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
