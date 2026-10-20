import { isAbsolute, posix } from 'node:path'

import {
	CONTAINER_BACKING_NEEDS,
	CONTAINER_POSTGRES_ROLES,
	CONTAINER_REGIONS,
	CONTAINER_SLEEP_AFTER_PATTERN,
	DEFAULT_CONTAINER_POSTGRES_ROLE,
	DEFAULT_CONTAINER_SLEEP_AFTER,
	MAX_CONTAINER_PORT,
	SATELLITE_CONTAINER_REGIONS,
} from '#/config/container-service.ts'
import {
	array,
	check,
	integer,
	maxValue,
	minValue,
	nonEmpty,
	number,
	object,
	optional,
	picklist,
	pipe,
	regex,
	string,
	unknown,
} from 'valibot'

import { readContainerInstance } from './deploy-container-instance.ts'
import {
	LEGACY_IMAGE_FIELD_REASONS,
	forbiddenServiceFields,
	internalWithoutUrlError,
	serviceBaseFields,
	toServiceBase,
} from './deploy-service-fields.ts'
import { missingKeyMessages, runSchema } from './valibot.ts'

import type {
	ContainerInstanceType,
	ContainerPostgresRole,
	ContainerRegion,
} from '#/config/container-service.ts'
import type { ContainerServiceConfig, ProjectSection } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ParsedServiceBase } from './deploy-service-fields.ts'
import type { ValidationResult } from './result.ts'

type ParsedContainerService = ParsedServiceBase & {
	image: string
	context?: string | undefined
	port: number
	instance?: unknown
	sleep_after: string
	regions?: ContainerRegion[] | undefined
	postgres_role?: ContainerPostgresRole | undefined
}

const CONTAINER_FORBIDDEN_FIELD_REASONS: Readonly<Record<string, string>> = {
	entry: 'a container service runs its `image`, not a Worker script - drop `entry`',
	assets: 'a container service serves what its image serves - drop `assets`',
	rate_limiters:
		'a rate limiter is a Worker binding, which a container cannot read - use `rate_limit` for a rule on the hostname, or drop `rate_limiters`',
	...LEGACY_IMAGE_FIELD_REASONS,
}

// A path relative to the nextnode.toml directory: an absolute path would tie
// the config to one machine's layout.
const relativePath = (msg: string): GenericSchema<unknown, string> =>
	pipe(
		string(msg),
		nonEmpty(msg),
		check(path => !isAbsolute(path), msg),
	)

const hasPrimaryRegion = (regions: ContainerRegion[]): boolean =>
	regions.some(region => !SATELLITE_CONTAINER_REGIONS.includes(region))

const regionsSchema = (
	name: string,
): GenericSchema<unknown, ContainerRegion[] | undefined> => {
	const prefix = `deploy.services.${name}.regions`
	const entryMessage = `${prefix} entries must be one of ${CONTAINER_REGIONS.join(', ')}`
	return optional(
		pipe(
			array(
				picklist(CONTAINER_REGIONS, entryMessage),
				`${prefix} must be an array of region codes`,
			),
			nonEmpty(`${prefix} must list at least one region when set`),
			check(
				hasPrimaryRegion,
				`${prefix} cannot list only ${SATELLITE_CONTAINER_REGIONS.join(', ')} - add a primary region such as WEUR`,
			),
		),
	)
}

const containerServiceSchema = (
	name: string,
): GenericSchema<unknown, ParsedContainerService> => {
	const portMessage = `deploy.services.${name}.port is required on a container service: the port the image listens on, an integer from 1 to ${MAX_CONTAINER_PORT}`
	const sleepMessage = `deploy.services.${name}.sleep_after must be a duration like "10m": digits then s, m or h`
	return object(
		{
			...serviceBaseFields(name),
			image: relativePath(
				`deploy.services.${name}.image must be the path of the Dockerfile, relative to nextnode.toml`,
			),
			context: optional(
				relativePath(
					`deploy.services.${name}.context must be the Docker build context directory, relative to nextnode.toml`,
				),
			),
			port: pipe(
				number(portMessage),
				integer(portMessage),
				minValue(1, portMessage),
				maxValue(MAX_CONTAINER_PORT, portMessage),
			),
			// Named or custom: read by `readContainerInstance` for precise messages.
			instance: optional(unknown()),
			sleep_after: optional(
				pipe(
					string(sleepMessage),
					regex(CONTAINER_SLEEP_AFTER_PATTERN, sleepMessage),
				),
				DEFAULT_CONTAINER_SLEEP_AFTER,
			),
			regions: regionsSchema(name),
			postgres_role: optional(
				picklist(
					CONTAINER_POSTGRES_ROLES,
					`deploy.services.${name}.postgres_role must be one of ${CONTAINER_POSTGRES_ROLES.join(', ')}`,
				),
			),
			...forbiddenServiceFields(
				name,
				'container',
				CONTAINER_FORBIDDEN_FIELD_REASONS,
			),
		},
		missingKeyMessages({ port: portMessage }),
	)
}

// A container receives no Worker binding: only the backing services reachable
// over the network with credentials core injects are allowed in `needs`.
function unreachableNeedErrors(
	name: string,
	needs: ReadonlyArray<string>,
): string[] {
	return needs
		.filter(need => !CONTAINER_BACKING_NEEDS.includes(need))
		.map(
			need =>
				`deploy.services.${name}.needs lists "${need}", which a container cannot reach: bindings (D1, KV, Queues, sibling Workers) are not reachable from a container - only ${CONTAINER_BACKING_NEEDS.join(' and ')} are supported, and a sibling Worker can list "${name}" in its own needs instead`,
		)
}

const PLANETSCALE_NEED = 'planetscale'

function postgresRoleError(
	name: string,
	parsed: Pick<ParsedContainerService, 'needs' | 'postgres_role'>,
): string | undefined {
	if (
		typeof parsed.postgres_role === 'undefined' ||
		parsed.needs.includes(PLANETSCALE_NEED)
	)
		return undefined
	return `deploy.services.${name}.postgres_role only applies to a container that needs planetscale - add "${PLANETSCALE_NEED}" to needs or drop postgres_role`
}

function toContainerService(
	parsed: ParsedContainerService,
	instance: ContainerInstanceType,
	project: Pick<ProjectSection, 'internal'>,
): ContainerServiceConfig {
	return {
		...toServiceBase(parsed, project),
		kind: 'container',
		image: parsed.image,
		context: parsed.context ?? posix.dirname(parsed.image),
		port: parsed.port,
		instance,
		sleepAfter: parsed.sleep_after,
		...(parsed.regions && { regions: parsed.regions }),
		...(parsed.needs.includes(PLANETSCALE_NEED) && {
			postgresRole:
				parsed.postgres_role ?? DEFAULT_CONTAINER_POSTGRES_ROLE,
		}),
	}
}

export function validateContainerService(
	name: string,
	rawService: Record<string, unknown>,
	project: Pick<ProjectSection, 'internal'>,
): ValidationResult<ContainerServiceConfig> {
	const validation = runSchema(containerServiceSchema(name), rawService)
	if (!validation.ok) return validation
	const parsed = validation.section
	const instance = readContainerInstance(name, parsed.instance)
	const shapeErrors = [
		internalWithoutUrlError(name, parsed),
		postgresRoleError(name, parsed),
	].filter(error => typeof error === 'string')
	const errors = [
		...(instance.ok ? [] : instance.errors),
		...unreachableNeedErrors(name, parsed.needs),
		...shapeErrors,
	]
	if (!instance.ok || errors.length) return { ok: false, errors }
	return {
		ok: true,
		section: toContainerService(parsed, instance.section, project),
	}
}
