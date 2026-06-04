import {
	DEFAULT_DEPLOY_TARGETS,
	DEFAULT_SERVICE_PORT,
	DEPLOY_IMAGE_SOURCES,
	DEPLOY_TARGETS,
	KEBAB_IDENTIFIER_PATTERN,
	SECRET_GENERATORS,
	isDeployTarget,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import {
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
	DeploySection,
	DeployTargetType,
	DeployVolume,
	DeployableProjectType,
	GeneratedSecretConfig,
	SecretGenerator,
	UserServiceConfig,
} from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ValidationResult } from './result.ts'

const MIN_TCP_PORT = 1
const MAX_TCP_PORT = 65_535

// --- secrets -------------------------------------------------------------

// `[deploy].secrets` entries are either a bare NAME (a must-exist GitHub secret)
// or a `{ name, generate, length }` table (the infra generates + pushes it at
// provision). `length` is the produced secret's CHARACTER count.
const MIN_SECRET_LENGTH = 8
const MAX_SECRET_LENGTH = 256

const SECRETS_NOT_ARRAY = 'deploy.secrets must be an array'
const SECRET_ENTRY_INVALID =
	'deploy.secrets entries must be a non-empty secret name or a { name, generate, length } table'

type ParsedSecretEntry =
	| { readonly kind: 'error'; readonly message: string }
	| { readonly kind: 'name'; readonly name: string }
	| { readonly kind: 'generated'; readonly spec: GeneratedSecretConfig }

function isSecretGenerator(value: string): value is SecretGenerator {
	return SECRET_GENERATORS.some(generator => generator === value)
}

function parseGeneratedSecret(
	entry: Record<string, unknown>,
): ParsedSecretEntry {
	const name = entry['name']
	if (typeof name !== 'string' || name === '') {
		return {
			kind: 'error',
			message:
				'deploy.secrets generated entry must declare a non-empty string `name`',
		}
	}
	const generate = entry['generate']
	if (typeof generate !== 'string' || !isSecretGenerator(generate)) {
		return {
			kind: 'error',
			message: `deploy.secrets entry "${name}" \`generate\` must be one of: ${SECRET_GENERATORS.join(', ')}`,
		}
	}
	const length = entry['length']
	if (
		typeof length !== 'number' ||
		!Number.isInteger(length) ||
		length < MIN_SECRET_LENGTH ||
		length > MAX_SECRET_LENGTH
	) {
		return {
			kind: 'error',
			message: `deploy.secrets entry "${name}" \`length\` must be an integer between ${MIN_SECRET_LENGTH} and ${MAX_SECRET_LENGTH}`,
		}
	}
	return { kind: 'generated', spec: { name, generate, length } }
}

function parseSecretEntry(entry: unknown): ParsedSecretEntry {
	if (typeof entry === 'string') {
		if (entry === '')
			return { kind: 'error', message: SECRET_ENTRY_INVALID }
		return { kind: 'name', name: entry }
	}
	if (isRecord(entry)) return parseGeneratedSecret(entry)
	return { kind: 'error', message: SECRET_ENTRY_INVALID }
}

// Parse `[deploy].secrets` into the flat NAME pool (every entry's name, for
// pickSecrets) and the generation specs (the table entries, for provisioning).
// Duplicate names are rejected — a name declared twice is an ambiguous source.
function parseSecretEntries(raw: unknown): {
	errors: string[]
	names: string[]
	generated: GeneratedSecretConfig[]
} {
	if (raw === undefined) return { errors: [], names: [], generated: [] }
	if (!Array.isArray(raw)) {
		return { errors: [SECRETS_NOT_ARRAY], names: [], generated: [] }
	}

	const errors: string[] = []
	const names: string[] = []
	const generated: GeneratedSecretConfig[] = []
	const seen = new Set<string>()
	for (const entry of raw) {
		const parsed = parseSecretEntry(entry)
		if (parsed.kind === 'error') {
			errors.push(parsed.message)
			continue
		}
		const name = parsed.kind === 'name' ? parsed.name : parsed.spec.name
		if (seen.has(name)) {
			errors.push(`deploy.secrets declares "${name}" more than once`)
			continue
		}
		seen.add(name)
		names.push(name)
		if (parsed.kind === 'generated') generated.push(parsed.spec)
	}
	return { errors, names, generated }
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
				build_args: string[]
		  }
		| {
				source: 'upstream'
				context?: undefined
				dockerfile?: undefined
				target?: undefined
				build_args?: undefined
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
		...(parsed.target !== undefined ? { target: parsed.target } : {}),
		...(parsed.build_args.length > 0
			? { buildArgs: parsed.build_args }
			: {}),
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
					build_args: stringArray(
						`deploy.services.${name}.build_args must be an array of strings`,
						`deploy.services.${name}.build_args entries must be non-empty strings`,
					),
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
					build_args: forbiddenField(
						`deploy.services.${name}.build_args is only allowed when source = "build"`,
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

// Fold the GLOBAL `[deploy].secrets` names into every service's own `secrets`
// (global ∪ own, deduped, global-first) so the per-service routing in
// `service-env.ts` — which keys off `service.secrets` — injects a global secret
// into every `.env.<service>` without any further wiring. No-op when there are
// no globals.
function expandServiceSecrets(
	services: Record<string, UserServiceConfig>,
	globalNames: ReadonlyArray<string>,
): Record<string, UserServiceConfig> {
	if (globalNames.length === 0) return services
	return Object.fromEntries(
		Object.entries(services).map(
			([name, service]): [string, UserServiceConfig] => [
				name,
				{
					...service,
					secrets: [...new Set([...globalNames, ...service.secrets])],
				},
			],
		),
	)
}

// Resolve the secret pool — the set of GitHub Secret NAMES the pipeline pulls
// for this deploy — and the generation specs, per target:
//   - cloudflare-pages parses [deploy].secrets directly: one deployable unit,
//     no per-service split, so the pool IS the declared list.
//   - hetzner-vps treats [deploy].secrets as the GLOBAL pool (injected into
//     every service via `expandServiceSecrets`) and the pool is that union with
//     each service's own per-service (least-privilege) secrets.
// Either way a `{ name, generate, length }` entry contributes its name to the
// pool and its spec to `generatedSecrets`. A name declared but absent from
// GitHub Secrets still fails loud at deploy time in `pickSecrets`.
function resolveSecrets(
	target: DeployTargetType,
	deployRecord: Record<string, unknown>,
	services: Record<string, UserServiceConfig>,
): {
	errors: string[]
	secrets: ReadonlyArray<string>
	generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
	services: Record<string, UserServiceConfig>
} {
	const parsed = parseSecretEntries(deployRecord['secrets'])
	if (target !== 'hetzner-vps') {
		return {
			errors: parsed.errors,
			secrets: parsed.names,
			generatedSecrets: parsed.generated,
			services,
		}
	}

	const expanded = expandServiceSecrets(services, parsed.names)
	const pool = new Set<string>(parsed.names)
	for (const service of Object.values(expanded)) {
		for (const secret of service.secrets) pool.add(secret)
	}
	return {
		errors: parsed.errors,
		secrets: [...pool],
		generatedSecrets: parsed.generated,
		services: expanded,
	}
}

// Every backing service a workload lists in `needs` must be declared as a
// top-level [services.<name>] — `needs = ["postgres"]` requires
// [services.postgres], or the backing secrets it expects (e.g. `DATABASE_URL`)
// would never be produced and the workload would start against nothing. Skipped
// when any service failed to parse (the declared set would be incomplete).
function validateServiceNeedsRefs(
	servicesResult: {
		errors: string[]
		services: Record<string, UserServiceConfig>
	},
	declaredServices: ReadonlySet<string>,
): string[] {
	if (servicesResult.errors.length > 0) return []

	const errors: string[] = []
	for (const [name, service] of Object.entries(servicesResult.services)) {
		for (const need of service.needs) {
			if (declaredServices.has(need)) continue
			errors.push(
				`deploy.services.${name}.needs references "${need}" but no [services.${need}] is declared`,
			)
		}
	}
	return errors
}

// Every sibling a service lists in `depends_on` must itself be a declared
// [deploy.services.<name>] — compose turns each entry into a startup gate (D7),
// and a gate on a non-existent service would never resolve. Backing
// dependencies (the `needs` field, e.g. postgres) are wired separately in M3.
// Skipped when any service failed to parse: the declared-name pool would be
// incomplete, turning a sibling's parse error into a spurious "unknown service".
function validateServiceDependsOnRefs(servicesResult: {
	errors: string[]
	services: Record<string, UserServiceConfig>
}): string[] {
	if (servicesResult.errors.length > 0) return []

	const declared = new Set(Object.keys(servicesResult.services))
	const errors: string[] = []
	for (const [name, service] of Object.entries(servicesResult.services)) {
		for (const ref of service.dependsOn) {
			if (declared.has(ref)) continue
			errors.push(
				`deploy.services.${name}.depends_on references unknown service "${ref}" — declare it in [deploy.services]`,
			)
		}
	}
	return errors
}

// Resolve [deploy.services.<name>] into a typed Record. Returns an empty Record
// when the table is absent — whether at least one service is *required* is a
// provider decision (see `requiresServices`). N services are accepted; each
// entry is validated independently so one malformed service doesn't sink its
// siblings.
function validateServices(deployRecord: Record<string, unknown>): {
	errors: string[]
	services: Record<string, UserServiceConfig>
} {
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
	domain: string | undefined,
	declaredServices: ReadonlySet<string>,
): ValidationResult<DeploySection> {
	if (raw !== undefined && !isRecord(raw)) {
		return { ok: false, errors: ['[deploy] must be a table'] }
	}

	const deployRecord = isRecord(raw) ? raw : {}
	const errors: string[] = []

	if (deployRecord['image'] !== undefined) {
		errors.push(
			'deploy.image is an unknown field — migrate to [deploy.services.<name>]',
		)
	}

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

	const provider = DEPLOY_PROVIDER_VALIDATORS[target]
	const providerResult = provider.validate(
		deployRecord,
		secretsResult.secrets,
		secretsResult.generatedSecrets,
		vpsResult.vps,
		volumesResult.volumes,
		secretsResult.services,
		domain,
	)
	errors.push(...providerResult.errors)

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

	if (errors.length > 0) return { ok: false, errors }

	if (!providerResult.deploy) {
		return { ok: false, errors: ['Provider validation failed'] }
	}

	return { ok: true, section: providerResult.deploy }
}
