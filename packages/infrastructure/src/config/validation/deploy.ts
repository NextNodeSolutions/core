import {
	DEFAULT_DEPLOY_TARGETS,
	DEPLOY_TARGETS,
	isDeployTarget,
	KEBAB_IDENTIFIER_PATTERN,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { pipe, regex } from 'valibot'

import { resolveSecrets } from './deploy-secrets.ts'
import {
	validateServiceDependsOnRefs,
	validateServiceNeedsRefs,
	validateServices,
} from './deploy-services.ts'
import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'
import { nonEmptyString, optionalNonEmpty, runSchema } from './valibot.ts'

import type {
	DeploySection,
	DeployTargetType,
	DeployVolume,
	DeployableProjectType,
} from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ResolvedSecrets } from './deploy-secrets.ts'
import type {
	DeployProviderValidator,
	ParsedDeployInputs,
} from './providers/registry.ts'
import type { ValidationResult } from './result.ts'

// --- vps -----------------------------------------------------------------

const VPS_MSG = 'deploy.vps must be a non-empty string'

const vpsSchema = optionalNonEmpty(VPS_MSG)

function validateVps(deployRecord: Record<string, unknown>): {
	errors: string[]
	vps: string | null
} {
	const validation = runSchema(vpsSchema, deployRecord['vps'])
	if (!validation.ok) return { errors: validation.errors, vps: null }
	return { errors: [], vps: validation.section ?? null }
}

// --- volumes -------------------------------------------------------------

const VOLUMES_NOT_TABLE =
	'[deploy.volumes] must be a table mapping alias to mount path'

const volumeMountSchema = (name: string): GenericSchema<unknown, string> =>
	pipe(
		nonEmptyString(
			`deploy.volumes.${name} must be a non-empty absolute mount path`,
		),
		regex(/^\//, issue => {
			const mountPath = typeof issue.input === 'string' ? issue.input : ''
			return `deploy.volumes.${name} must be an absolute path (got "${mountPath}")`
		}),
	)

function validateVolumes(deployRecord: Record<string, unknown>): {
	errors: string[]
	volumes: ReadonlyArray<DeployVolume>
} {
	const raw = deployRecord['volumes']
	if (raw === undefined) return { errors: [], volumes: [] }
	if (!isRecord(raw)) return { errors: [VOLUMES_NOT_TABLE], volumes: [] }

	const errors: string[] = []
	const volumes: DeployVolume[] = []
	for (const [name, rawMount] of Object.entries(raw)) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.volumes alias "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		const validation = runSchema(volumeMountSchema(name), rawMount)
		if (!validation.ok) {
			errors.push(...validation.errors)
			continue
		}
		volumes.push({ name, mount: validation.section })
	}
	return { errors, volumes }
}

// --- deploy section --------------------------------------------------------

interface DeployFieldsOptions {
	readonly target: DeployTargetType
	readonly domain: string | undefined
	readonly declaredServices: ReadonlySet<string>
}

// Run the per-field validators (vps, volumes, services, secrets) and assemble
// the inputs the provider validator needs, collecting every error.
function validateDeployFields(
	deployRecord: Record<string, unknown>,
	{ target, domain, declaredServices }: DeployFieldsOptions,
): {
	errors: string[]
	providerInputs: ParsedDeployInputs
	servicesResult: ResolvedSecrets
} {
	const errors: string[] = []
	const vpsResult = validateVps(deployRecord)
	errors.push(...vpsResult.errors)

	const volumesResult = validateVolumes(deployRecord)
	errors.push(...volumesResult.errors)

	const servicesResult = validateServices(deployRecord)
	errors.push(...servicesResult.errors)
	errors.push(...validateServiceDependsOnRefs(servicesResult))
	errors.push(...validateServiceNeedsRefs(servicesResult, declaredServices))

	// Pool resolution folds the global [deploy].secrets into each service, so it
	// runs AFTER services are validated and yields the EXPANDED services the
	// provider then assembles into the section.
	const secretsResult = resolveSecrets(
		target,
		deployRecord,
		servicesResult.services,
	)
	errors.push(...secretsResult.errors)

	return {
		errors,
		servicesResult: secretsResult,
		providerInputs: {
			secrets: secretsResult.secrets,
			generatedSecrets: secretsResult.generatedSecrets,
			vps: vpsResult.vps,
			volumes: volumesResult.volumes,
			services: secretsResult.services,
			domain,
		},
	}
}

// `deploy.image` predates [deploy.services.<name>] and silently ignoring it
// would deploy nothing the dev expects - surface the migration explicitly.
function legacyImageFieldErrors(
	deployRecord: Record<string, unknown>,
): string[] {
	if (deployRecord['image'] === undefined) return []
	return [
		'deploy.image is an unknown field - migrate to [deploy.services.<name>]',
	]
}

// Provider-level requirements that span fields: a domain when the target
// routes through Caddy/ACME, and at least one service when the target deploys
// containers. The services check is skipped while per-service errors exist -
// they already explain why the table is unusable.
function providerRequirementErrors(
	provider: DeployProviderValidator,
	domain: string | undefined,
	servicesResult: ResolvedSecrets,
): string[] {
	const errors: string[] = []
	if (provider.requiresDomain && domain === undefined) {
		errors.push(
			'project.domain is required when deploy target is "hetzner-vps"',
		)
	}
	if (
		provider.requiresServices &&
		servicesResult.errors.length === 0 &&
		Object.keys(servicesResult.services).length === 0
	) {
		errors.push('at least one [deploy.services.<name>] is required')
	}
	return errors
}

export function validateDeploySection(
	raw: unknown,
	projectType: DeployableProjectType,
	domain: string | undefined,
	declaredServices: ReadonlySet<string>,
): ValidationResult<DeploySection> {
	if (raw !== undefined && !isRecord(raw)) {
		return { ok: false, errors: ['[deploy] must be a table'] }
	}

	const deployRecord = isRecord(raw) ? raw : {}

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

	const fields = validateDeployFields(deployRecord, {
		target,
		domain,
		declaredServices,
	})

	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const providerResult = provider.validate(
		deployRecord,
		fields.providerInputs,
	)

	const errors = [
		...legacyImageFieldErrors(deployRecord),
		...fields.errors,
		...providerResult.errors,
		...providerRequirementErrors(provider, domain, fields.servicesResult),
	]

	if (errors.length > 0) return { ok: false, errors }

	if (!providerResult.deploy) {
		return { ok: false, errors: ['Provider validation failed'] }
	}

	return { ok: true, section: providerResult.deploy }
}
