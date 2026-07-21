import {
	DEFAULT_WORKER_ENTRY,
	KEBAB_IDENTIFIER_PATTERN,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { object, optional } from 'valibot'

import {
	forbiddenField,
	nonEmptyString,
	optionalNonEmpty,
	runSchema,
	stringArray,
} from './valibot.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'

const containerFieldRejection = (
	name: string,
	field: string,
	why: string,
): string =>
	`deploy.services.${name}.${field} is not supported with deploy target "cloudflare-workers" (a Worker is not a container: ${why})`

type ParsedWorkerService = {
	url?: string | undefined
	secrets: string[]
	needs: string[]
	depends_on: string[]
	entry: string
	port?: undefined
	source?: undefined
	ref?: undefined
	registry_auth_secret?: undefined
	context?: undefined
	dockerfile?: undefined
	target?: undefined
	build_args?: undefined
}

const CONTAINER_FIELD_REASONS: Readonly<Record<string, string>> = {
	port: 'it has no listening port - drop `port`',
	source: 'it is not built or pulled as an image - drop `source`',
	ref: 'there is no image to pull - drop `ref`',
	registry_auth_secret:
		'there is no registry to authenticate against - drop `registry_auth_secret`',
	context: 'it has no Docker build context - drop `context`',
	dockerfile: 'it has no Dockerfile - drop `dockerfile`',
	target: 'it has no Docker build stage - drop `target`',
	build_args:
		'it has no Docker build - point `entry` at the bundle and drop `build_args`',
}

const containerFieldsForbidden = (
	name: string,
): Record<string, GenericSchema<unknown, undefined>> =>
	Object.fromEntries(
		Object.entries(CONTAINER_FIELD_REASONS).map(([field, why]) => [
			field,
			forbiddenField(containerFieldRejection(name, field, why)),
		]),
	)

const workerServiceSchema = (
	name: string,
): GenericSchema<unknown, ParsedWorkerService> =>
	object({
		url: optionalNonEmpty(
			`deploy.services.${name}.url must be a non-empty string`,
		),
		secrets: stringArray(
			`deploy.services.${name}.secrets must be an array of strings`,
			`deploy.services.${name}.secrets entries must be non-empty strings`,
		),
		needs: stringArray(
			`deploy.services.${name}.needs must be an array of strings`,
			`deploy.services.${name}.needs entries must be non-empty strings`,
		),
		depends_on: stringArray(
			`deploy.services.${name}.depends_on must be an array of strings`,
			`deploy.services.${name}.depends_on entries must be non-empty strings`,
		),
		entry: optional(
			nonEmptyString(
				`deploy.services.${name}.entry must be a non-empty string`,
			),
			DEFAULT_WORKER_ENTRY,
		),
		...containerFieldsForbidden(name),
	})

function toWorkerService(parsed: ParsedWorkerService): WorkerServiceConfig {
	return {
		...(parsed.url === undefined ? {} : { url: parsed.url }),
		secrets: parsed.secrets,
		needs: parsed.needs,
		dependsOn: parsed.depends_on,
		entry: parsed.entry,
	}
}

export interface WorkerServicesValidation {
	errors: string[]
	services: Record<string, WorkerServiceConfig>
}

export function validateWorkerServices(
	deployRecord: Record<string, unknown>,
): WorkerServicesValidation {
	const raw = deployRecord['services']
	if (raw === undefined) return { errors: [], services: {} }
	if (!isRecord(raw)) {
		return { errors: ['[deploy.services] must be a table'], services: {} }
	}

	const errors: string[] = []
	const services: Record<string, WorkerServiceConfig> = {}
	for (const [name, rawService] of Object.entries(raw)) {
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
		const validation = runSchema(workerServiceSchema(name), rawService)
		if (!validation.ok) {
			errors.push(...validation.errors)
			continue
		}
		services[name] = toWorkerService(validation.section)
	}
	return { errors, services }
}
