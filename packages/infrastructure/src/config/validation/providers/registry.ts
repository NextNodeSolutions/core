import { cloudflarePages } from './cloudflare-pages.ts'
import { hetznerVps } from './hetzner.ts'

import type {
	DeploySection,
	DeployTargetType,
	DeployVolume,
	GeneratedSecretConfig,
	UserServiceConfig,
} from '#/config/types.ts'

export interface DeployProviderResult {
	readonly errors: string[]
	readonly deploy: DeploySection | undefined
}

export interface DeployProviderValidator {
	readonly requiresDomain: boolean
	// Whether this target requires at least one [deploy.services.<name>] entry.
	readonly requiresServices: boolean
	validate(
		deployRecord: Record<string, unknown>,
		secrets: ReadonlyArray<string>,
		generatedSecrets: ReadonlyArray<GeneratedSecretConfig>,
		vps: string | null,
		volumes: ReadonlyArray<DeployVolume>,
		services: Record<string, UserServiceConfig>,
		// project.domain (undefined when unset) — the ACME/Caddy ownership root
		// each routed service `url` must belong to. See validateServiceUrls.
		domain: string | undefined,
	): DeployProviderResult
}

export const DEPLOY_PROVIDER_VALIDATORS: Record<
	DeployTargetType,
	DeployProviderValidator
> = {
	'hetzner-vps': hetznerVps,
	'cloudflare-pages': cloudflarePages,
}
