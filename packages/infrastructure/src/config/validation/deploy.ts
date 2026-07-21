import { isDeployTarget } from '#/config/predicates.ts'
import {
	DEFAULT_DEPLOY_TARGETS,
	DEPLOY_TARGETS,
	impliableServiceNames,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import { resolveSecrets } from './deploy-secrets.ts'
import {
	validateServiceDependsOnRefs,
	validateServiceNeedsRefs,
	validateServices,
} from './deploy-services.ts'
import { validateVolumes } from './deploy-volumes.ts'
import { validateWorkerServices } from './deploy-worker-services.ts'
import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'
import { optionalNonEmpty, runSchema } from './valibot.ts'

import type {
	DeploySection,
	DeployTargetType,
	DeployableProjectType,
} from '#/config/types.ts'
import type { ResolvedSecrets } from './deploy-secrets.ts'
import type { ServiceRefs } from './deploy-services.ts'
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

// --- deploy section --------------------------------------------------------

interface DeployFieldsOptions {
	readonly target: DeployTargetType
	readonly domain: string | undefined
	readonly declaredServices: ReadonlySet<string>
}

interface ServiceCheck {
	readonly errors: ReadonlyArray<string>
	readonly count: number
}

interface DeployFields {
	errors: string[]
	providerInputs: ParsedDeployInputs
	serviceCheck: ServiceCheck
}

interface ResolvedServices<T> {
	errors: string[]
	serviceCheck: ServiceCheck
	secretsResult: ResolvedSecrets<T>
}

// Parse [deploy.services], cross-validate `needs`/`depends_on`, then fold the
// global [deploy].secrets pool into each service - in THAT order, since the fold
// needs the validated services. The `parse` strategy is the only difference
// between the container and Worker targets (a Worker is not a container).
function resolveServices<
	T extends ServiceRefs & { secrets: ReadonlyArray<string> },
>(
	deployRecord: Record<string, unknown>,
	target: DeployTargetType,
	declaredServices: ReadonlySet<string>,
	parse: (record: Record<string, unknown>) => {
		errors: string[]
		services: Record<string, T>
	},
): ResolvedServices<T> {
	const parsed = parse(deployRecord)
	const errors = [
		...parsed.errors,
		...validateServiceDependsOnRefs(parsed),
		...validateServiceNeedsRefs(parsed, declaredServices),
	]
	const secretsResult = resolveSecrets(target, deployRecord, parsed.services)
	errors.push(...secretsResult.errors)
	return {
		errors,
		serviceCheck: {
			errors: parsed.errors,
			count: Object.keys(secretsResult.services).length,
		},
		secretsResult,
	}
}

// Run the per-field validators (vps, volumes, services, secrets) and assemble
// the inputs the provider validator needs, collecting every error.
function validateDeployFields(
	deployRecord: Record<string, unknown>,
	{ target, domain, declaredServices }: DeployFieldsOptions,
): DeployFields {
	const vpsResult = validateVps(deployRecord)
	const volumesResult = validateVolumes(deployRecord)
	const shared = {
		vps: vpsResult.vps,
		volumes: volumesResult.volumes,
		domain,
	}
	const fieldErrors = [...vpsResult.errors, ...volumesResult.errors]

	if (target === 'cloudflare-workers') {
		const { errors, serviceCheck, secretsResult } = resolveServices(
			deployRecord,
			target,
			new Set([...declaredServices, ...impliableServiceNames(target)]),
			validateWorkerServices,
		)
		return {
			errors: [...fieldErrors, ...errors],
			serviceCheck,
			providerInputs: {
				...shared,
				secrets: secretsResult.secrets,
				generatedSecrets: secretsResult.generatedSecrets,
				services: {},
				workerServices: secretsResult.services,
			},
		}
	}

	const { errors, serviceCheck, secretsResult } = resolveServices(
		deployRecord,
		target,
		declaredServices,
		validateServices,
	)
	return {
		errors: [...fieldErrors, ...errors],
		serviceCheck,
		providerInputs: {
			...shared,
			secrets: secretsResult.secrets,
			generatedSecrets: secretsResult.generatedSecrets,
			services: secretsResult.services,
			workerServices: {},
		},
	}
}

// `deploy.image` predates [deploy.services.<name>] and silently ignoring it
// would deploy nothing the dev expects - surface the migration explicitly.
function legacyImageFieldErrors(
	deployRecord: Record<string, unknown>,
): string[] {
	if (typeof deployRecord['image'] === 'undefined') return []
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
	target: DeployTargetType,
	domain: string | undefined,
	serviceCheck: ServiceCheck,
): string[] {
	const errors: string[] = []
	if (provider.requiresDomain && typeof domain === 'undefined') {
		errors.push(
			`project.domain is required when deploy target is "${target}"`,
		)
	}
	if (
		provider.requiresServices &&
		serviceCheck.errors.length === 0 &&
		serviceCheck.count === 0
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
	if (typeof raw !== 'undefined' && !isRecord(raw)) {
		return { ok: false, errors: ['[deploy] must be a table'] }
	}

	let deployRecord: Record<string, unknown> = {}
	if (isRecord(raw)) deployRecord = raw

	const rawTarget = deployRecord['target']
	if (typeof rawTarget !== 'undefined' && !isDeployTarget(rawTarget)) {
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
		...providerRequirementErrors(
			provider,
			target,
			domain,
			fields.serviceCheck,
		),
	]

	if (errors.length > 0) return { ok: false, errors }

	if (!providerResult.deploy) {
		return { ok: false, errors: ['Provider validation failed'] }
	}

	return { ok: true, section: providerResult.deploy }
}
