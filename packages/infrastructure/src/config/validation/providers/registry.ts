import type { DeploySection, DeployTargetType } from '../../types.ts'

import { cloudflarePages } from './cloudflare-pages.ts'
import { hetznerVps } from './hetzner.ts'

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
	): DeployProviderResult
}

export const DEPLOY_PROVIDER_VALIDATORS: Record<
	DeployTargetType,
	DeployProviderValidator
> = {
	'hetzner-vps': hetznerVps,
	'cloudflare-pages': cloudflarePages,
}
