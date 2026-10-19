import { cloudflareWorkers } from './cloudflare-workers.ts'

import type {
	DeploySection,
	DeployTargetType,
	WorkerServiceConfig,
} from '#/config/types.ts'

export interface DeployProviderResult<
	K extends DeployTargetType = DeployTargetType,
> {
	readonly errors: string[]
	readonly deploy: Extract<DeploySection, { readonly target: K }> | undefined
}
export interface ParsedDeployInputs {
	readonly workerServices: Record<string, WorkerServiceConfig>
	readonly domain: string | undefined
}

export interface DeployProviderValidator<
	K extends DeployTargetType = DeployTargetType,
> {
	readonly requiresDomain: boolean
	readonly requiresServices: boolean
	validate(
		deployRecord: Record<string, unknown>,
		inputs: ParsedDeployInputs,
	): DeployProviderResult<K>
}

// A provider can only return a section of the target it is registered under.
export const DEPLOY_PROVIDER_VALIDATORS: {
	readonly [K in DeployTargetType]: DeployProviderValidator<K>
} = {
	'cloudflare-workers': cloudflareWorkers,
}
