import type {
	DeployableProjectType,
	DeploySection,
	DeployTargetType,
	HetznerDeployConfig,
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

function validateHetznerConfig(deployRecord: Record<string, unknown>): {
	errors: string[]
	hetzner: HetznerDeployConfig | undefined
} {
	const rawHetzner = deployRecord['hetzner']
	if (!isRecord(rawHetzner)) {
		return {
			errors: [
				'[deploy.hetzner] section is required when target is "hetzner-vps"',
			],
			hetzner: undefined,
		}
	}
	const serverType = rawHetzner['server_type']
	const location = rawHetzner['location']
	if (typeof serverType !== 'string' || serverType === '') {
		const errors = [
			'deploy.hetzner.server_type is required and must be a string',
		]
		if (typeof location !== 'string' || location === '') {
			errors.push(
				'deploy.hetzner.location is required and must be a string',
			)
		}
		return { errors, hetzner: undefined }
	}
	if (typeof location !== 'string' || location === '') {
		return {
			errors: [
				'deploy.hetzner.location is required and must be a string',
			],
			hetzner: undefined,
		}
	}
	return {
		errors: [],
		hetzner: { serverType, location },
	}
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

	let hetzner: HetznerDeployConfig | undefined
	if (target === 'hetzner-vps') {
		const hetznerResult = validateHetznerConfig(deployRecord)
		errors.push(...hetznerResult.errors)
		hetzner = hetznerResult.hetzner
		if (!hasDomain) {
			errors.push(
				'project.domain is required when deploy target is "hetzner-vps"',
			)
		}
	}

	if (errors.length > 0) return { errors, deploy: false }

	return {
		errors: [],
		deploy: { target, secrets: secretsResult.secrets, hetzner },
	}
}
