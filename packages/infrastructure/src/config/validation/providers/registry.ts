import { cloudflarePages } from './cloudflare-pages.ts'
import { hetznerVps } from './hetzner.ts'

import type {
	DeployImageConfig,
	DeploySection,
	DeployTargetType,
	DeployVolume,
	UserServiceConfig,
} from '#/config/types.ts'

export interface DeployProviderResult {
	readonly errors: string[]
	readonly deploy: DeploySection | undefined
}

export interface DeployProviderValidator {
	readonly requiresDomain: boolean
	validate(
		deployRecord: Record<string, unknown>,
		secrets: ReadonlyArray<string>,
		vps: string | null,
		volumes: ReadonlyArray<DeployVolume>,
		image: DeployImageConfig,
		services: Record<string, UserServiceConfig>,
	): DeployProviderResult
}

export const DEPLOY_PROVIDER_VALIDATORS: Record<
	DeployTargetType,
	DeployProviderValidator
> = {
	'hetzner-vps': hetznerVps,
	'cloudflare-pages': cloudflarePages,
}
