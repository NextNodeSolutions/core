import { isDeployTarget } from '#/config/predicates.ts'
import { impliableServiceNames } from '#/config/service-config.ts'
import { DEFAULT_DEPLOY_TARGETS, DEPLOY_TARGETS } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import { REMOVED_SECRETS_FIELD_REASON } from './deploy-removed-fields.ts'
import {
	validateServiceDependsOnRefs,
	validateServiceNeedsRefs,
} from './deploy-services.ts'
import { validateWorkerServices } from './deploy-worker-services.ts'
import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'

import type {
	DeploySection,
	DeployTargetType,
	DeployableProjectType,
	ProjectSection,
} from '#/config/types.ts'
import type { ValidationResult } from './result.ts'

function selectTarget(
	rawTarget: unknown,
	projectType: DeployableProjectType,
): DeployTargetType | undefined {
	if (typeof rawTarget === 'undefined')
		return DEFAULT_DEPLOY_TARGETS[projectType]
	if (!isDeployTarget(rawTarget)) return undefined
	return rawTarget
}

function removedSecretsErrors(deployRecord: Record<string, unknown>): string[] {
	if (typeof deployRecord['secrets'] === 'undefined') return []
	return [`deploy.secrets is not supported: ${REMOVED_SECRETS_FIELD_REASON}`]
}

export function validateDeploySection(
	raw: unknown,
	projectType: DeployableProjectType,
	project: Pick<ProjectSection, 'domain' | 'internal'>,
	declaredServices: ReadonlySet<string>,
): ValidationResult<DeploySection> {
	const { domain } = project
	const deployRecord = raw ?? {}
	if (!isRecord(deployRecord))
		return { ok: false, errors: ['[deploy] must be a table'] }
	const target = selectTarget(deployRecord['target'], projectType)
	if (typeof target === 'undefined')
		return {
			ok: false,
			errors: [
				`deploy.target must be one of: ${DEPLOY_TARGETS.join(', ')}`,
			],
		}
	const parsed = validateWorkerServices(deployRecord, project)
	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const validatedProvider = provider.validate(deployRecord, {
		workerServices: parsed.services,
		domain,
	})
	const errors = [
		...removedSecretsErrors(deployRecord),
		...parsed.errors,
		...validateServiceDependsOnRefs(parsed),
		...validateServiceNeedsRefs(
			parsed,
			new Set([...declaredServices, ...impliableServiceNames(target)]),
		),
		...validatedProvider.errors,
	]
	if (provider.requiresDomain && !domain)
		errors.push('project.domain is required')
	if (
		provider.requiresServices &&
		!parsed.errors.length &&
		!Object.keys(parsed.services).length
	) {
		errors.push('at least one [deploy.services.<name>] is required')
	}
	if (errors.length) return { ok: false, errors }
	if (!validatedProvider.deploy)
		return { ok: false, errors: ['Provider validation failed'] }
	return { ok: true, section: validatedProvider.deploy }
}
