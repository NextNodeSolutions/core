import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import { serviceSchema, toUserService } from './deploy-service-schema.ts'
import { runSchema } from './valibot.ts'

import type { UserServiceConfig } from '#/config/types.ts'

export interface ServicesValidation {
	errors: string[]
	services: Record<string, UserServiceConfig>
}

// Resolve [deploy.services.<name>] into a typed Record. Returns an empty Record
// when the table is absent - whether at least one service is *required* is a
// provider decision (see `requiresServices`). N services are accepted; each
// entry is validated independently so one malformed service doesn't sink its
// siblings.
export function validateServices(
	deployRecord: Record<string, unknown>,
): ServicesValidation {
	const raw = deployRecord['services']
	if (raw === undefined) {
		return { errors: [], services: {} }
	}
	if (!isRecord(raw)) {
		return { errors: ['[deploy.services] must be a table'], services: {} }
	}

	const entries = Object.entries(raw)

	const errors: string[] = []
	const services: Record<string, UserServiceConfig> = {}
	for (const [name, rawService] of entries) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.services name "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		if (!isRecord(rawService)) {
			errors.push(`[deploy.services.${name}] must be a table`)
			continue
		}
		const validation = runSchema(serviceSchema(name), rawService)
		if (!validation.ok) {
			errors.push(...validation.errors)
			continue
		}
		services[name] = toUserService(name, validation.section)
	}
	return { errors, services }
}

// Every backing service a workload lists in `needs` must be declared as a
// top-level [services.<name>] - `needs = ["postgres"]` requires
// [services.postgres], or the backing secrets it expects (e.g. `DATABASE_URL`)
// would never be produced and the workload would start against nothing. Skipped
// when any service failed to parse (the declared set would be incomplete).
export function validateServiceNeedsRefs(
	servicesResult: ServicesValidation,
	declaredServices: ReadonlySet<string>,
): string[] {
	if (servicesResult.errors.length > 0) return []

	return Object.entries(servicesResult.services).flatMap(([name, service]) =>
		service.needs
			.filter(need => !declaredServices.has(need))
			.map(
				need =>
					`deploy.services.${name}.needs references "${need}" but no [services.${need}] is declared`,
			),
	)
}

// Every sibling a service lists in `depends_on` must itself be a declared
// [deploy.services.<name>] - compose turns each entry into a startup gate (D7),
// and a gate on a non-existent service would never resolve. Backing
// dependencies (the `needs` field, e.g. postgres) are wired separately in M3.
// Skipped when any service failed to parse: the declared-name pool would be
// incomplete, turning a sibling's parse error into a spurious "unknown service".
export function validateServiceDependsOnRefs(
	servicesResult: ServicesValidation,
): string[] {
	if (servicesResult.errors.length > 0) return []

	const declared = new Set(Object.keys(servicesResult.services))
	const errors: string[] = Object.entries(servicesResult.services).flatMap(
		([name, service]) =>
			service.dependsOn
				.filter(ref => !declared.has(ref))
				.map(
					ref =>
						`deploy.services.${name}.depends_on references unknown service "${ref}" - declare it in [deploy.services]`,
				),
	)
	return errors
}
