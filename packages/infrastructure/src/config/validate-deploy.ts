import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'
import type {
	DeployableProjectType,
	DeploySection,
	DeployTargetType,
	ProjectType,
} from './types.ts'
import {
	DEFAULT_DEPLOY_TARGETS,
	DEPLOY_TARGETS,
	DEPLOYABLE_PROJECT_TYPES,
	isDeployTarget,
	isRecord,
} from './types.ts'

function isDeployableProjectType(
	value: string,
): value is DeployableProjectType {
	return DEPLOYABLE_PROJECT_TYPES.has(value)
}

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
	raw: Record<string, unknown>,
	projectType: ProjectType,
	hasDomain: boolean,
): {
	errors: string[]
	deploy: DeploySection | false
} {
	const deploy = raw['deploy']

	if (!isDeployableProjectType(projectType)) {
		if (deploy !== undefined) {
			return {
				errors: [
					`[deploy] section is forbidden for project type "${projectType}"`,
				],
				deploy: false,
			}
		}
		return { errors: [], deploy: false }
	}

	if (deploy !== undefined && !isRecord(deploy)) {
		return { errors: ['[deploy] must be a table'], deploy: false }
	}

	const deployRecord = isRecord(deploy) ? deploy : {}
	const errors: string[] = []

	const rawTarget = deployRecord['target']
	let target: DeployTargetType
	if (rawTarget === undefined) {
		target = DEFAULT_DEPLOY_TARGETS[projectType]
	} else if (isDeployTarget(rawTarget)) {
		target = rawTarget
	} else {
		return {
			errors: [
				`deploy.target must be one of: ${DEPLOY_TARGETS.join(', ')}`,
			],
			deploy: false,
		}
	}

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

	if (errors.length > 0) return { errors, deploy: false }

	if (!providerResult.deploy) {
		return { errors: ['Provider validation failed'], deploy: false }
	}

	return { errors: [], deploy: providerResult.deploy }
}
