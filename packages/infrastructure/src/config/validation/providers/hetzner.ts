import type { HetznerDeployConfig } from '../../types.ts'
import { isRecord } from '../../types.ts'

import type { DeployProviderValidator } from './registry.ts'

export const DEFAULT_HETZNER_CONFIG: HetznerDeployConfig = {
	serverType: 'cx23',
	location: 'nbg1',
}

function validateHetznerConfig(deployRecord: Record<string, unknown>): {
	errors: string[]
	hetzner: HetznerDeployConfig
} {
	const rawHetzner = deployRecord['hetzner']
	if (rawHetzner === undefined) {
		return { errors: [], hetzner: DEFAULT_HETZNER_CONFIG }
	}
	if (!isRecord(rawHetzner)) {
		return {
			errors: ['[deploy.hetzner] must be a table'],
			hetzner: DEFAULT_HETZNER_CONFIG,
		}
	}
	const errors: string[] = []
	const rawServerType = rawHetzner['server_type']
	const rawLocation = rawHetzner['location']

	if (
		rawServerType !== undefined &&
		(typeof rawServerType !== 'string' || rawServerType === '')
	) {
		errors.push('deploy.hetzner.server_type must be a non-empty string')
	}
	if (
		rawLocation !== undefined &&
		(typeof rawLocation !== 'string' || rawLocation === '')
	) {
		errors.push('deploy.hetzner.location must be a non-empty string')
	}
	if (errors.length > 0) {
		return { errors, hetzner: DEFAULT_HETZNER_CONFIG }
	}

	return {
		errors: [],
		hetzner: {
			serverType:
				typeof rawServerType === 'string'
					? rawServerType
					: DEFAULT_HETZNER_CONFIG.serverType,
			location:
				typeof rawLocation === 'string'
					? rawLocation
					: DEFAULT_HETZNER_CONFIG.location,
		},
	}
}

export const hetznerVps: DeployProviderValidator = {
	requiresDomain: true,
	validate(deployRecord, secrets) {
		const result = validateHetznerConfig(deployRecord)
		if (result.errors.length > 0) {
			return { errors: result.errors, deploy: undefined }
		}
		return {
			errors: [],
			deploy: {
				target: 'hetzner-vps',
				secrets,
				hetzner: result.hetzner,
			},
		}
	},
}
