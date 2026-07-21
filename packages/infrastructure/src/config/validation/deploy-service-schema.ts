import { DEFAULT_SERVICE_PORT, DEPLOY_IMAGE_SOURCES } from '#/config/types.ts'
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
	variant,
} from 'valibot'

import {
	forbiddenField,
	nonEmptyString,
	optionalNonEmpty,
	stringArray,
} from './valibot.ts'

import type {
	BuildServiceConfig,
	ServiceCommon,
	UpstreamServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { GenericSchema } from 'valibot'

const MIN_TCP_PORT = 1
const MAX_TCP_PORT = 65_535

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
export type ParsedService = ServiceCommonParsed &
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
type MutableServiceCommon = {
	-readonly [K in keyof ServiceCommon]: ServiceCommon[K]
}
type MutableBuildServiceConfig = {
	-readonly [K in keyof BuildServiceConfig]: BuildServiceConfig[K]
}
type MutableUpstreamServiceConfig = {
	-readonly [K in keyof UpstreamServiceConfig]: UpstreamServiceConfig[K]
}

export function toUserService(
	name: string,
	parsed: ParsedService,
): UserServiceConfig {
	const common: MutableServiceCommon = {
		port: parsed.port,
		secrets: parsed.secrets,
		needs: parsed.needs,
		dependsOn: parsed.depends_on,
	}
	if (parsed.url) common.url = parsed.url

	if (parsed.source === 'upstream') {
		if (typeof parsed.ref === 'undefined') {
			throw new Error(
				`deploy.services.${name}: upstream ref absent after validation - schema invariant broken`,
			)
		}
		const upstream: MutableUpstreamServiceConfig = {
			source: 'upstream',
			ref: parsed.ref,
		}
		if (parsed.registry_auth_secret) {
			upstream.registryAuthSecret = parsed.registry_auth_secret
		}
		return { ...common, ...upstream }
	}

	const build: MutableBuildServiceConfig = { source: 'build' }
	if (parsed.context) build.context = parsed.context
	if (parsed.dockerfile) build.dockerfile = parsed.dockerfile
	if (parsed.target) build.target = parsed.target
	if (parsed.build_args.length > 0) build.buildArgs = parsed.build_args
	return { ...common, ...build }
}

type BuildServiceEntries = ServiceCommonEntries & {
	source: GenericSchema<unknown, 'build' | undefined>
	ref: GenericSchema<unknown, undefined>
	registry_auth_secret: GenericSchema<unknown, undefined>
	context: GenericSchema<unknown, string | undefined>
	dockerfile: GenericSchema<unknown, string | undefined>
	target: GenericSchema<unknown, string | undefined>
	build_args: GenericSchema<unknown, string[]>
}

type UpstreamServiceEntries = ServiceCommonEntries & {
	source: GenericSchema<unknown, 'upstream'>
	context: GenericSchema<unknown, undefined>
	dockerfile: GenericSchema<unknown, undefined>
	target: GenericSchema<unknown, undefined>
	build_args: GenericSchema<unknown, undefined>
	ref: GenericSchema<unknown, string | undefined>
	registry_auth_secret: GenericSchema<unknown, string | undefined>
}

// `variant` options must be plain object schemas (the discriminator is read
// structurally), so the two members are inlined here. The upstream `ref` is
// `optional` (not required) with the "ref required" rule in the OUTER pipe
// `check`: a required entry would emit valibot's generic "Invalid key" message
// when the key is MISSING, whereas the check surfaces the custom message for
// both the absent and empty-string cases. The snake→camel shaping into
// UserServiceConfig happens in `toUserService` once the parse has succeeded.
const buildServiceEntries = (name: string): BuildServiceEntries => ({
	source: optional(literal('build')),
	ref: forbiddenField(
		`deploy.services.${name}.ref is only allowed when source = "upstream"`,
	),
	registry_auth_secret: forbiddenField(
		`deploy.services.${name}.registry_auth_secret is only allowed when source = "upstream"`,
	),
	context: optionalNonEmpty(`deploy.services.${name}.context`),
	dockerfile: optionalNonEmpty(`deploy.services.${name}.dockerfile`),
	target: optionalNonEmpty(`deploy.services.${name}.target`),
	build_args: stringArray(
		`deploy.services.${name}.build_args must be an array of strings`,
		`deploy.services.${name}.build_args entries must be non-empty strings`,
	),
	...serviceCommonEntries(name),
})

const upstreamServiceEntries = (
	name: string,
	refMsg: string,
): UpstreamServiceEntries => ({
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
})

export const serviceSchema = (
	name: string,
): GenericSchema<unknown, ParsedService> => {
	const refMsg = `deploy.services.${name}.ref is required and must be a non-empty string when source = "upstream"`
	return pipe(
		variant(
			'source',
			[
				object(buildServiceEntries(name)),
				object(upstreamServiceEntries(name, refMsg)),
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
