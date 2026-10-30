import {
	DEFAULT_WORKER_ENTRY,
	KEBAB_IDENTIFIER_PATTERN,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { literal, object, optional, union } from 'valibot'

import { validateContainerService } from './deploy-container-services.ts'
import {
	LEGACY_IMAGE_FIELD_REASONS,
	forbiddenServiceFields,
	internalWithoutUrlError,
	serviceBaseFields,
	toServiceBase,
} from './deploy-service-fields.ts'
import { nonEmptyString, optionalNonEmpty, runSchema } from './valibot.ts'

import type {
	DeployServiceConfig,
	ProjectSection,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ParsedServiceBase } from './deploy-service-fields.ts'
import type { ValidationResult } from './result.ts'

type ParsedWorkerService = ParsedServiceBase & {
	entry: string | false
	assets?: string | undefined
}

// A Worker service that names a container field most likely forgot `image`:
// the message says how a container is declared.
const declareImageInstead = (field: string): string =>
	`only a container service has one - declare \`image = "<Dockerfile path>"\` to deploy the service as a Cloudflare Container, or drop \`${field}\``

const WORKER_FORBIDDEN_FIELD_REASONS: Readonly<Record<string, string>> = {
	port: declareImageInstead('port'),
	context: declareImageInstead('context'),
	instance: declareImageInstead('instance'),
	sleep_after: declareImageInstead('sleep_after'),
	regions: declareImageInstead('regions'),
	postgres_role: declareImageInstead('postgres_role'),
	...LEGACY_IMAGE_FIELD_REASONS,
}

const workerServiceSchema = (
	name: string,
): GenericSchema<unknown, ParsedWorkerService> =>
	object({
		...serviceBaseFields(name),
		entry: optional(
			union([
				nonEmptyString(
					`deploy.services.${name}.entry must be a non-empty string`,
				),
				// `entry = false` opts out of the script entirely: a
				// static-assets-only Worker (assets required, see the cross-field
				// check below).
				literal(false),
			]),
			DEFAULT_WORKER_ENTRY,
		),
		assets: optionalNonEmpty(
			`deploy.services.${name}.assets must be a non-empty string`,
		),
		...forbiddenServiceFields(
			name,
			'Worker',
			WORKER_FORBIDDEN_FIELD_REASONS,
		),
	})

function toWorkerService(
	parsed: ParsedWorkerService,
	project: Pick<ProjectSection, 'internal'>,
): WorkerServiceConfig {
	return {
		...toServiceBase(parsed, project),
		kind: 'worker',
		entry: parsed.entry,
		...(typeof parsed.assets !== 'undefined' && { assets: parsed.assets }),
	}
}

export interface WorkerServicesValidation {
	errors: string[]
	services: Record<string, DeployServiceConfig>
}

// The assets directory has exactly one source per service shape: declared for a
// static-assets-only Worker, derived from the entry otherwise - so the two forms
// are mutually exclusive and `false` carries its directory.
function assetsShapeError(
	name: string,
	parsed: ParsedWorkerService,
): string | undefined {
	if (parsed.entry === false && typeof parsed.assets === 'undefined')
		return `deploy.services.${name}: \`entry = false\` (static-assets-only Worker) requires \`assets\` - declare the built assets directory`
	if (parsed.entry === false || typeof parsed.assets === 'undefined')
		return undefined
	return `deploy.services.${name}: \`assets\` is only valid with \`entry = false\` - a scripted Worker derives its assets directory from its entry`
}

function shapeError(
	name: string,
	parsed: ParsedWorkerService,
): string | undefined {
	return (
		assetsShapeError(name, parsed) ?? internalWithoutUrlError(name, parsed)
	)
}

function validateWorkerService(
	name: string,
	rawService: Record<string, unknown>,
	project: Pick<ProjectSection, 'internal'>,
): ValidationResult<WorkerServiceConfig> {
	const validation = runSchema(workerServiceSchema(name), rawService)
	if (!validation.ok) return validation
	const error = shapeError(name, validation.section)
	if (error) return { ok: false, errors: [error] }
	return { ok: true, section: toWorkerService(validation.section, project) }
}

// `image` is what makes a service a container; without it the Worker rules
// apply.
function validateDeployService(
	name: string,
	rawService: Record<string, unknown>,
	project: Pick<ProjectSection, 'internal'>,
): ValidationResult<DeployServiceConfig> {
	if (typeof rawService['image'] === 'undefined')
		return validateWorkerService(name, rawService, project)
	return validateContainerService(name, rawService, project)
}

function projectInternalErrors(
	project: Pick<ProjectSection, 'internal'>,
	services: Readonly<Record<string, DeployServiceConfig>>,
): string[] {
	const hasRoutedService = Object.values(services).some(
		service => service.url,
	)
	if (!project.internal || hasRoutedService) return []
	return ['project.internal requires at least one routed Worker with a url']
}

export function validateWorkerServices(
	deployRecord: Record<string, unknown>,
	project: Pick<ProjectSection, 'internal'>,
): WorkerServicesValidation {
	const raw = deployRecord['services']
	if (typeof raw === 'undefined') return { errors: [], services: {} }
	if (!isRecord(raw)) {
		return { errors: ['[deploy.services] must be a table'], services: {} }
	}

	const errors: string[] = []
	const services: Record<string, DeployServiceConfig> = {}
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
		const validation = validateDeployService(name, rawService, project)
		if (!validation.ok) {
			errors.push(...validation.errors)
			continue
		}
		services[name] = validation.section
	}
	if (errors.length) return { errors, services }
	return { errors: projectInternalErrors(project, services), services }
}
