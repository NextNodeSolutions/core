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

// The parsed pieces a provider validator assembles into a DeploySection,
// bundled so they pass as one value rather than six positional params.
export interface ParsedDeployInputs {
	readonly secrets: ReadonlyArray<string>
	readonly generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
	readonly vps: string | null
	readonly volumes: ReadonlyArray<DeployVolume>
	readonly services: Record<string, UserServiceConfig>
	// project.domain (undefined when unset) - the ACME/Caddy ownership root
	// each routed service `url` must belong to. See validateServiceUrls.
	readonly domain: string | undefined
}

export interface DeployProviderValidator {
	readonly requiresDomain: boolean
	// Whether this target requires at least one [deploy.services.<name>] entry.
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
	'hetzner-vps': hetznerVps,
	'cloudflare-pages': cloudflarePages,
}
