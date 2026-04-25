import type { HetznerDeployConfig } from '@/config/types.ts'
import { DEFAULT_HETZNER_CONFIG, isRecord } from '@/config/types.ts'

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

export const hetznerVps: DeployProviderValidator = {
	requiresDomain: true,
	validate(deployRecord, secrets) {
		const { errors, hetzner } = parseHetzner(deployRecord['hetzner'])
		if (!hetzner) return { errors, deploy: undefined }
		return {
			errors: [],
			deploy: { target: 'hetzner-vps', secrets, hetzner },
		}
	},
}
