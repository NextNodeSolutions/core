import type {
	DeploySection,
	DeployTargetType,
	DeployableProjectType,
} from '../types.ts'
import {
	DEFAULT_DEPLOY_TARGETS,
	DEPLOY_TARGETS,
	isDeployTarget,
	isRecord,
} from '../types.ts'

import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'
import type { ValidationResult } from './result.ts'

function validateSecrets(deployRecord: Record<string, unknown>): {
	errors: string[]
	secrets: ReadonlyArray<string>
} {
	const rawSecrets = deployRecord['secrets']
	if (rawSecrets === undefined) return { errors: [], secrets: [] }
	if (!Array.isArray(rawSecrets)) {
		return {
			errors: ['deploy.secrets must be an array of strings'],
			secrets: [],
		}
	}
	if (
		!rawSecrets.every(
			(entry): entry is string =>
				typeof entry === 'string' && entry !== '',
		)
	) {
		return {
			errors: ['deploy.secrets entries must be non-empty strings'],
			secrets: [],
		}
	}
	return { errors: [], secrets: rawSecrets }
}

export function validateDeploySection(
	raw: unknown,
	projectType: DeployableProjectType,
	hasDomain: boolean,
): ValidationResult<DeploySection> {
	if (raw !== undefined && !isRecord(raw)) {
		return { ok: false, errors: ['[deploy] must be a table'] }
	}

	const deployRecord = isRecord(raw) ? raw : {}
	const errors: string[] = []

	const rawTarget = deployRecord['target']
	if (rawTarget !== undefined && !isDeployTarget(rawTarget)) {
		return {
			ok: false,
			errors: [
				`deploy.target must be one of: ${DEPLOY_TARGETS.join(', ')}`,
			],
		}
	}

	const target: DeployTargetType =
		rawTarget ?? DEFAULT_DEPLOY_TARGETS[projectType]

	const secretsResult = validateSecrets(deployRecord)
	errors.push(...secretsResult.errors)

	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const providerResult = provider.validate(
		deployRecord,
		secretsResult.secrets,
	)
	errors.push(...providerResult.errors)

	if (provider.requiresDomain && !hasDomain) {
		errors.push(
			'project.domain is required when deploy target is "hetzner-vps"',
		)
	}

	if (errors.length > 0) return { ok: false, errors }

	if (!providerResult.deploy) {
		return { ok: false, errors: ['Provider validation failed'] }
	}

	return { ok: true, section: providerResult.deploy }
}
