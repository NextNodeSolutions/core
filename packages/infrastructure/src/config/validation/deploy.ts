import type {
	DeployImageConfig,
	DeploySection,
	DeployTargetType,
	DeployVolume,
	DeployableProjectType,
} from '#/config/types.ts'
import {
	DEFAULT_DEPLOY_IMAGE,
	DEFAULT_DEPLOY_TARGETS,
	DEPLOY_IMAGE_SOURCES,
	DEPLOY_TARGETS,
	KEBAB_IDENTIFIER_PATTERN,
	isDeployImageSource,
	isDeployTarget,
	isRecord,
} from '#/config/types.ts'

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

function validateVolumes(deployRecord: Record<string, unknown>): {
	errors: string[]
	volumes: ReadonlyArray<DeployVolume>
} {
	const raw = deployRecord['volumes']
	if (raw === undefined) return { errors: [], volumes: [] }
	if (!isRecord(raw)) {
		return {
			errors: [
				'[deploy.volumes] must be a table mapping alias to mount path',
			],
			volumes: [],
		}
	}
	const errors: string[] = []
	const volumes: DeployVolume[] = []
	for (const [name, value] of Object.entries(raw)) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.volumes alias "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		if (typeof value !== 'string' || value === '') {
			errors.push(
				`deploy.volumes.${name} must be a non-empty absolute mount path`,
			)
			continue
		}
		if (!value.startsWith('/')) {
			errors.push(
				`deploy.volumes.${name} must be an absolute path (got "${value}")`,
			)
			continue
		}
		volumes.push({ name, mount: value })
	}
	return { errors, volumes }
}

function validateImage(deployRecord: Record<string, unknown>): {
	errors: string[]
	image: DeployImageConfig
} {
	const raw = deployRecord['image']
	if (raw === undefined) return { errors: [], image: DEFAULT_DEPLOY_IMAGE }
	if (!isRecord(raw)) {
		return {
			errors: ['[deploy.image] must be a table'],
			image: DEFAULT_DEPLOY_IMAGE,
		}
	}

	const rawSource = raw['source']
	if (rawSource !== undefined && !isDeployImageSource(rawSource)) {
		return {
			errors: [
				`deploy.image.source must be one of: ${DEPLOY_IMAGE_SOURCES.join(', ')}`,
			],
			image: DEFAULT_DEPLOY_IMAGE,
		}
	}

	const source = rawSource ?? 'build'

	if (source === 'build') {
		if (raw['ref'] !== undefined) {
			return {
				errors: [
					'deploy.image.ref is only allowed when deploy.image.source = "upstream"',
				],
				image: DEFAULT_DEPLOY_IMAGE,
			}
		}
		if (raw['registry_auth_secret'] !== undefined) {
			return {
				errors: [
					'deploy.image.registry_auth_secret is only allowed when deploy.image.source = "upstream"',
				],
				image: DEFAULT_DEPLOY_IMAGE,
			}
		}
		return { errors: [], image: { source: 'build' } }
	}

	const rawRef = raw['ref']
	if (typeof rawRef !== 'string' || rawRef === '') {
		return {
			errors: [
				'deploy.image.ref is required and must be a non-empty string when deploy.image.source = "upstream"',
			],
			image: DEFAULT_DEPLOY_IMAGE,
		}
	}

	const rawAuth = raw['registry_auth_secret']
	if (
		rawAuth !== undefined &&
		(typeof rawAuth !== 'string' || rawAuth === '')
	) {
		return {
			errors: [
				'deploy.image.registry_auth_secret must be a non-empty string',
			],
			image: DEFAULT_DEPLOY_IMAGE,
		}
	}

	return {
		errors: [],
		image:
			rawAuth === undefined
				? { source: 'upstream', ref: rawRef }
				: {
						source: 'upstream',
						ref: rawRef,
						registryAuthSecret: rawAuth,
					},
	}
}

function validateVps(deployRecord: Record<string, unknown>): {
	errors: string[]
	vps: string | null
} {
	const raw = deployRecord['vps']
	if (raw === undefined) return { errors: [], vps: null }
	if (typeof raw !== 'string' || raw === '') {
		return { errors: ['deploy.vps must be a non-empty string'], vps: null }
	}
	return { errors: [], vps: raw }
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

	const vpsResult = validateVps(deployRecord)
	errors.push(...vpsResult.errors)

	const volumesResult = validateVolumes(deployRecord)
	errors.push(...volumesResult.errors)

	const imageResult = validateImage(deployRecord)
	errors.push(...imageResult.errors)

	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const providerResult = provider.validate(
		deployRecord,
		secretsResult.secrets,
		vpsResult.vps,
		volumesResult.volumes,
		imageResult.image,
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
