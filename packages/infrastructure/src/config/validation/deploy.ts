import {
	DEFAULT_DEPLOY_IMAGE,
	DEFAULT_DEPLOY_TARGETS,
	DEFAULT_SERVICE_PORT,
	DEPLOY_IMAGE_SOURCES,
	DEPLOY_TARGETS,
	KEBAB_IDENTIFIER_PATTERN,
	isDeployImageSource,
	isDeployTarget,
	isRecord,
} from '#/config/types.ts'

import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'

import type {
	BuildServiceConfig,
	DeployImageConfig,
	DeploySection,
	DeployTargetType,
	DeployVolume,
	DeployableProjectType,
	UpstreamServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { ValidationResult } from './result.ts'

const MIN_TCP_PORT = 1
const MAX_TCP_PORT = 65_535

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value !== ''

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
	if (!rawSecrets.every(isNonEmptyString)) {
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

function parseOptionalNonEmpty(
	raw: unknown,
	path: string,
	errors: string[],
): string | undefined {
	if (raw === undefined) return undefined
	if (typeof raw !== 'string' || raw === '') {
		errors.push(`${path} must be a non-empty string`)
		return undefined
	}
	return raw
}

function parseStringArray(
	raw: unknown,
	path: string,
	errors: string[],
): string[] {
	if (raw === undefined) return []
	if (!Array.isArray(raw) || !raw.every(isNonEmptyString)) {
		errors.push(`${path} must be an array of non-empty strings`)
		return []
	}
	return raw
}

type ServiceVariantResult = {
	errors: string[]
	variant?: BuildServiceConfig | UpstreamServiceConfig
}

function validateBuildVariant(
	name: string,
	raw: Record<string, unknown>,
): ServiceVariantResult {
	const errors: string[] = []
	if (raw['ref'] !== undefined) {
		errors.push(
			`deploy.services.${name}.ref is only allowed when source = "upstream"`,
		)
	}
	if (raw['registry_auth_secret'] !== undefined) {
		errors.push(
			`deploy.services.${name}.registry_auth_secret is only allowed when source = "upstream"`,
		)
	}
	const context = parseOptionalNonEmpty(
		raw['context'],
		`deploy.services.${name}.context`,
		errors,
	)
	const dockerfile = parseOptionalNonEmpty(
		raw['dockerfile'],
		`deploy.services.${name}.dockerfile`,
		errors,
	)
	const target = parseOptionalNonEmpty(
		raw['target'],
		`deploy.services.${name}.target`,
		errors,
	)
	if (errors.length > 0) return { errors }
	return {
		errors: [],
		variant: {
			source: 'build',
			...(context !== undefined ? { context } : {}),
			...(dockerfile !== undefined ? { dockerfile } : {}),
			target: target ?? name,
		},
	}
}

function validateUpstreamVariant(
	name: string,
	raw: Record<string, unknown>,
): ServiceVariantResult {
	const errors: string[] = []
	for (const field of ['context', 'dockerfile', 'target'] as const) {
		if (raw[field] !== undefined) {
			errors.push(
				`deploy.services.${name}.${field} is only allowed when source = "build"`,
			)
		}
	}
	const rawRef = raw['ref']
	if (typeof rawRef !== 'string' || rawRef === '') {
		errors.push(
			`deploy.services.${name}.ref is required and must be a non-empty string when source = "upstream"`,
		)
	}
	const registryAuthSecret = parseOptionalNonEmpty(
		raw['registry_auth_secret'],
		`deploy.services.${name}.registry_auth_secret`,
		errors,
	)
	if (errors.length > 0 || typeof rawRef !== 'string' || rawRef === '') {
		return { errors }
	}
	return {
		errors: [],
		variant: {
			source: 'upstream',
			ref: rawRef,
			...(registryAuthSecret !== undefined ? { registryAuthSecret } : {}),
		},
	}
}

function validateServiceSource(
	name: string,
	raw: Record<string, unknown>,
): ServiceVariantResult {
	const rawSource = raw['source']
	if (rawSource !== undefined && !isDeployImageSource(rawSource)) {
		return {
			errors: [
				`deploy.services.${name}.source must be one of: ${DEPLOY_IMAGE_SOURCES.join(', ')}`,
			],
		}
	}
	return (rawSource ?? 'build') === 'build'
		? validateBuildVariant(name, raw)
		: validateUpstreamVariant(name, raw)
}

function validateService(
	name: string,
	raw: unknown,
): { errors: string[]; service?: UserServiceConfig } {
	if (!isRecord(raw)) {
		return { errors: [`[deploy.services.${name}] must be a table`] }
	}

	const errors: string[] = []

	let port = DEFAULT_SERVICE_PORT
	const rawPort = raw['port']
	if (rawPort !== undefined) {
		if (
			typeof rawPort !== 'number' ||
			!Number.isInteger(rawPort) ||
			rawPort < MIN_TCP_PORT ||
			rawPort > MAX_TCP_PORT
		) {
			errors.push(
				`deploy.services.${name}.port must be an integer between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}`,
			)
		} else {
			port = rawPort
		}
	}

	const url = parseOptionalNonEmpty(
		raw['url'],
		`deploy.services.${name}.url`,
		errors,
	)
	const secrets = parseStringArray(
		raw['secrets'],
		`deploy.services.${name}.secrets`,
		errors,
	)
	const needs = parseStringArray(
		raw['needs'],
		`deploy.services.${name}.needs`,
		errors,
	)
	const dependsOn = parseStringArray(
		raw['depends_on'],
		`deploy.services.${name}.depends_on`,
		errors,
	)

	const sourceResult = validateServiceSource(name, raw)
	errors.push(...sourceResult.errors)

	if (errors.length > 0 || !sourceResult.variant) return { errors }

	const common = {
		port,
		secrets,
		needs,
		dependsOn,
		...(url !== undefined ? { url } : {}),
	}
	return { errors: [], service: { ...common, ...sourceResult.variant } }
}

function synthesizeServiceFromImage(
	image: DeployImageConfig,
): UserServiceConfig {
	const common = {
		port: DEFAULT_SERVICE_PORT,
		secrets: [],
		needs: [],
		dependsOn: [],
	}
	if (image.source === 'upstream') {
		return {
			...common,
			source: 'upstream',
			ref: image.ref,
			...(image.registryAuthSecret !== undefined
				? { registryAuthSecret: image.registryAuthSecret }
				: {}),
		}
	}
	return { ...common, source: 'build', target: 'app' }
}

// Resolve [deploy.services.<name>] into a typed Record. When the table is
// absent, synthesize a single `app` service from the legacy `image` so every
// downstream consumer can already read `services` during the M1 migration. M1
// is single-service only — more than one declared service is rejected (the cap
// is lifted in M2.A-01).
function validateServices(
	deployRecord: Record<string, unknown>,
	image: DeployImageConfig,
): { errors: string[]; services: Record<string, UserServiceConfig> } {
	const raw = deployRecord['services']
	if (raw === undefined) {
		return {
			errors: [],
			services: { app: synthesizeServiceFromImage(image) },
		}
	}
	if (!isRecord(raw)) {
		return { errors: ['[deploy.services] must be a table'], services: {} }
	}

	const entries = Object.entries(raw)
	if (entries.length > 1) {
		return {
			errors: [
				`M1 supports a single [deploy.services.<name>] (got ${entries.length}: ${entries
					.map(([n]) => n)
					.join(', ')}); multi-service lands in M2`,
			],
			services: {},
		}
	}

	const errors: string[] = []
	const services: Record<string, UserServiceConfig> = {}
	for (const [name, value] of entries) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.services name "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		const result = validateService(name, value)
		errors.push(...result.errors)
		if (result.service) services[name] = result.service
	}
	return { errors, services }
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

	const servicesResult = validateServices(deployRecord, imageResult.image)
	errors.push(...servicesResult.errors)

	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const providerResult = provider.validate(
		deployRecord,
		secretsResult.secrets,
		vpsResult.vps,
		volumesResult.volumes,
		imageResult.image,
		servicesResult.services,
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
