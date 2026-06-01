import { DEFAULT_HETZNER_CONFIG } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import type { HetznerDeployConfig, UserServiceConfig } from '#/config/types.ts'
import type { DeployProviderValidator } from './registry.ts'

type FieldResult = { error?: string; value?: string }

function parseOptionalString(raw: unknown, path: string): FieldResult {
	if (raw === undefined) return {}
	if (typeof raw !== 'string' || raw === '') {
		return { error: `${path} must be a non-empty string` }
	}
	return { value: raw }
}

function parseHetzner(rawHetzner: unknown): {
	errors: string[]
	hetzner?: HetznerDeployConfig
} {
	if (rawHetzner === undefined) {
		return { errors: [], hetzner: DEFAULT_HETZNER_CONFIG }
	}
	if (!isRecord(rawHetzner)) {
		return { errors: ['[deploy.hetzner] must be a table'] }
	}

	const serverType = parseOptionalString(
		rawHetzner['server_type'],
		'deploy.hetzner.server_type',
	)
	const location = parseOptionalString(
		rawHetzner['location'],
		'deploy.hetzner.location',
	)
	const errors = [serverType.error, location.error].filter(
		(e): e is string => e !== undefined,
	)
	if (errors.length > 0) return { errors }

	return {
		errors: [],
		hetzner: {
			serverType: serverType.value ?? DEFAULT_HETZNER_CONFIG.serverType,
			location: location.value ?? DEFAULT_HETZNER_CONFIG.location,
		},
	}
}

// Cross-service routing guard for the Caddy/ACME layer: every externally routed
// service `url` must be unique — a duplicate would shadow the earlier Caddy
// route — and must be project.domain itself or a sub-domain of it, since ACME
// certs are only held for project.domain. Services without a `url` are
// internal-only and contribute nothing here. When `domain` is undefined the
// missing-domain error is already raised upstream, so ownership is left
// unchecked rather than double-reported.
function validateServiceUrls(
	services: Record<string, UserServiceConfig>,
	domain: string | undefined,
): string[] {
	const errors: string[] = []
	const firstSeenBy = new Map<string, string>()

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (url === undefined) continue

		const owner = firstSeenBy.get(url)
		if (owner === undefined) {
			firstSeenBy.set(url, name)
		} else {
			errors.push(
				`deploy.services.${name}.url "${url}" duplicates deploy.services.${owner}.url — each routed service needs a distinct url`,
			)
		}

		if (
			domain !== undefined &&
			url !== domain &&
			!url.endsWith(`.${domain}`)
		) {
			errors.push(
				`deploy.services.${name}.url "${url}" must belong to project.domain "${domain}" (equal to it or a sub-domain)`,
			)
		}
	}

	return errors
}

export const hetznerVps: DeployProviderValidator = {
	requiresDomain: true,
	requiresServices: true,
	validate(deployRecord, secrets, vps, volumes, services, domain) {
		const { errors, hetzner } = parseHetzner(deployRecord['hetzner'])
		const urlErrors = validateServiceUrls(services, domain)
		if (!hetzner) {
			return { errors: [...errors, ...urlErrors], deploy: undefined }
		}
		return {
			errors: urlErrors,
			deploy: {
				target: 'hetzner-vps',
				secrets,
				vps,
				volumes,
				hetzner,
				services,
			},
		}
	},
}
