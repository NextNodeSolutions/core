import {
	DEFAULT_DEPLOY_IMAGE,
	DEFAULT_DEPLOY_TARGETS,
	DEFAULT_SERVICE_PORT,
	DEPLOY_IMAGE_SOURCES,
	DEPLOY_TARGETS,
	KEBAB_IDENTIFIER_PATTERN,
	isDeployTarget,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import {
	array,
	check,
	integer,
	literal,
	maxValue,
	minValue,
	number,
	object,
	optional,
	pipe,
	regex,
	transform,
	variant,
} from 'valibot'

import { DEPLOY_PROVIDER_VALIDATORS } from './providers/registry.ts'
import {
	forbiddenField,
	nonEmptyString,
	optionalNonEmpty,
	runSchema,
	stringArray,
} from './valibot.ts'

import type {
	DeployImageConfig,
	DeploySection,
	DeployTargetType,
	DeployVolume,
	DeployableProjectType,
	UserServiceConfig,
} from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ValidationResult } from './result.ts'

const MIN_TCP_PORT = 1
const MAX_TCP_PORT = 65_535

// --- secrets -------------------------------------------------------------

const SECRETS_NOT_ARRAY = 'deploy.secrets must be an array of strings'
const SECRETS_ENTRY = 'deploy.secrets entries must be non-empty strings'

const secretsSchema = optional(
	array(nonEmptyString(SECRETS_ENTRY), SECRETS_NOT_ARRAY),
	[],
)

function validateSecrets(deployRecord: Record<string, unknown>): {
	errors: string[]
	secrets: ReadonlyArray<string>
} {
	const result = runSchema(secretsSchema, deployRecord['secrets'])
	if (!result.ok) return { errors: result.errors, secrets: [] }
	return { errors: [], secrets: result.section }
}

// --- vps -----------------------------------------------------------------

const VPS_MSG = 'deploy.vps must be a non-empty string'

const vpsSchema = optionalNonEmpty(VPS_MSG)

function validateVps(deployRecord: Record<string, unknown>): {
	errors: string[]
	vps: string | null
} {
	const result = runSchema(vpsSchema, deployRecord['vps'])
	if (!result.ok) return { errors: result.errors, vps: null }
	return { errors: [], vps: result.section ?? null }
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
			const value = typeof issue.input === 'string' ? issue.input : ''
			return `deploy.volumes.${name} must be an absolute path (got "${value}")`
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
	for (const [name, value] of Object.entries(raw)) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.volumes alias "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		const result = runSchema(volumeMountSchema(name), value)
		if (!result.ok) {
			errors.push(...result.errors)
			continue
		}
		volumes.push({ name, mount: result.section })
	}
	return { errors, volumes }
}

// --- image ---------------------------------------------------------------

const IMAGE_NOT_TABLE = '[deploy.image] must be a table'
const IMAGE_SOURCE_MSG = `deploy.image.source must be one of: ${DEPLOY_IMAGE_SOURCES.join(', ')}`
const IMAGE_REF_BUILD_FORBIDDEN =
	'deploy.image.ref is only allowed when deploy.image.source = "upstream"'
const IMAGE_AUTH_BUILD_FORBIDDEN =
	'deploy.image.registry_auth_secret is only allowed when deploy.image.source = "upstream"'
const IMAGE_REF_REQUIRED =
	'deploy.image.ref is required and must be a non-empty string when deploy.image.source = "upstream"'
const IMAGE_AUTH_NONEMPTY =
	'deploy.image.registry_auth_secret must be a non-empty string'

const imageBuildSchema = pipe(
	object({
		source: optional(literal('build')),
		ref: forbiddenField(IMAGE_REF_BUILD_FORBIDDEN),
		registry_auth_secret: forbiddenField(IMAGE_AUTH_BUILD_FORBIDDEN),
	}),
	transform((): DeployImageConfig => ({ source: 'build' })),
)

// `ref` is `optional` (not required) so that a MISSING key still reaches the
// outer `check` and surfaces IMAGE_REF_REQUIRED — a required entry would instead
// emit valibot's generic "Invalid key" message for the absent key.
const imageUpstreamSchema = pipe(
	object({
		source: literal('upstream'),
		ref: optional(nonEmptyString(IMAGE_REF_REQUIRED)),
		registry_auth_secret: optional(nonEmptyString(IMAGE_AUTH_NONEMPTY)),
	}),
	check(
		input => typeof input.ref === 'string' && input.ref !== '',
		IMAGE_REF_REQUIRED,
	),
	transform((input): DeployImageConfig => {
		const ref = typeof input.ref === 'string' ? input.ref : ''
		if (input.registry_auth_secret === undefined) {
			return { source: 'upstream', ref }
		}
		return {
			source: 'upstream',
			ref,
			registryAuthSecret: input.registry_auth_secret,
		}
	}),
)

const imageSchema = variant(
	'source',
	[imageBuildSchema, imageUpstreamSchema],
	IMAGE_SOURCE_MSG,
)

function validateImage(deployRecord: Record<string, unknown>): {
	errors: string[]
	image: DeployImageConfig
} {
	const raw = deployRecord['image']
	if (raw === undefined) return { errors: [], image: DEFAULT_DEPLOY_IMAGE }
	if (!isRecord(raw))
		return { errors: [IMAGE_NOT_TABLE], image: DEFAULT_DEPLOY_IMAGE }

	const result = runSchema(imageSchema, raw)
	if (!result.ok)
		return { errors: result.errors, image: DEFAULT_DEPLOY_IMAGE }
	return { errors: [], image: result.section }
}

// --- services ------------------------------------------------------------

const servicePortMsg = (name: string): string =>
	`deploy.services.${name}.port must be an integer between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}`

type ServiceCommonParsed = {
	port: number
	url?: string | undefined
	secrets: string[]
	needs: string[]
	depends_on: string[]
}

// The validated-but-not-yet-shaped service, as the variant emits it: snake_case
// keys, source-forbidden fields typed `undefined`, and the upstream `ref` still
// optional (its presence is enforced by the variant's `check`, surfaced when
// building the final config).
type ParsedService = ServiceCommonParsed &
	(
		| {
				source?: 'build' | undefined
				ref?: undefined
				registry_auth_secret?: undefined
				context?: string | undefined
				dockerfile?: string | undefined
				target?: string | undefined
		  }
		| {
				source: 'upstream'
				context?: undefined
				dockerfile?: undefined
				target?: undefined
				ref?: string | undefined
				registry_auth_secret?: string | undefined
		  }
	)

type ServiceCommonEntries = {
	port: GenericSchema<unknown, number>
	url: GenericSchema<unknown, string | undefined>
	secrets: GenericSchema<unknown, string[]>
	needs: GenericSchema<unknown, string[]>
	depends_on: GenericSchema<unknown, string[]>
}

const serviceCommonEntries = (name: string): ServiceCommonEntries => ({
	port: optional(
		pipe(
			number(servicePortMsg(name)),
			integer(servicePortMsg(name)),
			minValue(MIN_TCP_PORT, servicePortMsg(name)),
			maxValue(MAX_TCP_PORT, servicePortMsg(name)),
		),
		DEFAULT_SERVICE_PORT,
	),
	url: optionalNonEmpty(`deploy.services.${name}.url`),
	secrets: stringArray(`deploy.services.${name}.secrets`),
	needs: stringArray(`deploy.services.${name}.needs`),
	depends_on: stringArray(`deploy.services.${name}.depends_on`),
})

// Shape a validated service into its final UserServiceConfig. Called only on a
// successful parse, so the upstream `ref` is guaranteed present by the variant's
// `check`; the absent branch is an invariant violation, not a value to paper
// over (no `?? ''` placeholder).
function toUserService(name: string, parsed: ParsedService): UserServiceConfig {
	const common = {
		port: parsed.port,
		secrets: parsed.secrets,
		needs: parsed.needs,
		dependsOn: parsed.depends_on,
		...(parsed.url !== undefined ? { url: parsed.url } : {}),
	}
	if (parsed.source === 'upstream') {
		if (parsed.ref === undefined) {
			throw new Error(
				`deploy.services.${name}: upstream ref absent after validation — schema invariant broken`,
			)
		}
		return {
			...common,
			source: 'upstream',
			ref: parsed.ref,
			...(parsed.registry_auth_secret !== undefined
				? { registryAuthSecret: parsed.registry_auth_secret }
				: {}),
		}
	}
	return {
		...common,
		source: 'build',
		...(parsed.context !== undefined ? { context: parsed.context } : {}),
		...(parsed.dockerfile !== undefined
			? { dockerfile: parsed.dockerfile }
			: {}),
		target: parsed.target ?? name,
	}
}

// `variant` options must be plain object schemas (the discriminator is read
// structurally), so the two members are inlined here. The upstream `ref` is
// `optional` (not required) with the "ref required" rule in the OUTER pipe
// `check`: a required entry would emit valibot's generic "Invalid key" message
// when the key is MISSING, whereas the check surfaces the custom message for
// both the absent and empty-string cases. The snake→camel shaping into
// UserServiceConfig happens in `toUserService` once the parse has succeeded.
const serviceSchema = (name: string): GenericSchema<unknown, ParsedService> => {
	const refMsg = `deploy.services.${name}.ref is required and must be a non-empty string when source = "upstream"`
	return pipe(
		variant(
			'source',
			[
				object({
					source: optional(literal('build')),
					ref: forbiddenField(
						`deploy.services.${name}.ref is only allowed when source = "upstream"`,
					),
					registry_auth_secret: forbiddenField(
						`deploy.services.${name}.registry_auth_secret is only allowed when source = "upstream"`,
					),
					context: optionalNonEmpty(
						`deploy.services.${name}.context`,
					),
					dockerfile: optionalNonEmpty(
						`deploy.services.${name}.dockerfile`,
					),
					target: optionalNonEmpty(`deploy.services.${name}.target`),
					...serviceCommonEntries(name),
				}),
				object({
					source: literal('upstream'),
					context: forbiddenField(
						`deploy.services.${name}.context is only allowed when source = "build"`,
					),
					dockerfile: forbiddenField(
						`deploy.services.${name}.dockerfile is only allowed when source = "build"`,
					),
					target: forbiddenField(
						`deploy.services.${name}.target is only allowed when source = "build"`,
					),
					ref: optional(nonEmptyString(refMsg)),
					registry_auth_secret: optionalNonEmpty(
						`deploy.services.${name}.registry_auth_secret`,
					),
					...serviceCommonEntries(name),
				}),
			],
			`deploy.services.${name}.source must be one of: ${DEPLOY_IMAGE_SOURCES.join(', ')}`,
		),
		check(
			input =>
				input.source !== 'upstream' ||
				(typeof input.ref === 'string' && input.ref !== ''),
			refMsg,
		),
	)
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
		if (!isRecord(value)) {
			errors.push(`[deploy.services.${name}] must be a table`)
			continue
		}
		const result = runSchema(serviceSchema(name), value)
		if (!result.ok) {
			errors.push(...result.errors)
			continue
		}
		services[name] = toUserService(name, result.section)
	}
	return { errors, services }
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
