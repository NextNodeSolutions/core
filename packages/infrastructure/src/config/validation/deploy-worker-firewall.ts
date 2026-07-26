import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import {
	DEFAULT_RATE_LIMIT_MITIGATION_TIMEOUT,
	DEFAULT_RATE_LIMIT_PERIOD,
	HTTP_METHODS,
	RATE_LIMIT_MITIGATION_TIMEOUTS,
	RATE_LIMIT_PERIODS,
	RATE_LIMITER_PERIODS,
} from '#/config/worker-firewall.ts'
import {
	array,
	check,
	integer,
	minValue,
	nonEmpty,
	number,
	object,
	optional,
	picklist,
	pipe,
	regex,
	string,
} from 'valibot'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type {
	HttpMethod,
	RateLimiterPeriod,
	RateLimitMitigationTimeout,
	RateLimitPeriod,
	WorkerLimitsConfig,
	WorkerRateLimitConfig,
} from '#/config/worker-firewall.ts'
import type { GenericSchema } from 'valibot'

// A request path in the TOML: an exact path, or a trailing `*` standing for a
// prefix. Both firewall families share the grammar, so both share the pattern
// and the message that explains it.
const REQUEST_PATH_PATTERN = /^\//

const pathEntriesMessage = (prefix: string): string =>
	`${prefix} entries must start with "/" (an exact path, or a trailing "*" for a prefix)`

const pathArray = (prefix: string): GenericSchema<unknown, string[]> =>
	array(
		pipe(
			string(pathEntriesMessage(prefix)),
			regex(REQUEST_PATH_PATTERN, pathEntriesMessage(prefix)),
		),
		`${prefix} must be an array of strings`,
	)

const positiveInteger = (msg: string): GenericSchema<unknown, number> =>
	pipe(number(msg), integer(msg), minValue(1, msg))

interface ParsedRateLimit {
	paths: string[]
	methods?: HttpMethod[] | undefined
	requests_per_period: number
	period: RateLimitPeriod
	mitigation_timeout: RateLimitMitigationTimeout
}

interface ParsedLimits {
	cpu_ms?: number | undefined
	subrequests?: number | undefined
}

interface ParsedRateLimiter {
	name: string
	limit: number
	period: RateLimiterPeriod
}

export interface ParsedWorkerFirewall {
	rate_limit?: ParsedRateLimit | undefined
	public_paths?: string[] | undefined
	limits?: ParsedLimits | undefined
	rate_limiters?: ParsedRateLimiter[] | undefined
}

const rateLimitSchema = (
	name: string,
): GenericSchema<unknown, ParsedRateLimit | undefined> => {
	const prefix = `deploy.services.${name}.rate_limit`
	const methodsMessage = `${prefix}.methods entries must be one of ${HTTP_METHODS.join(', ')}`
	return optional(
		object(
			{
				paths: pipe(
					pathArray(`${prefix}.paths`),
					nonEmpty(`${prefix}.paths must declare at least one path`),
				),
				methods: optional(
					array(
						picklist(HTTP_METHODS, methodsMessage),
						methodsMessage,
					),
				),
				requests_per_period: positiveInteger(
					`${prefix}.requests_per_period must be a positive integer`,
				),
				period: optional(
					picklist(
						RATE_LIMIT_PERIODS,
						`${prefix}.period must be one of ${RATE_LIMIT_PERIODS.join(', ')} seconds`,
					),
					DEFAULT_RATE_LIMIT_PERIOD,
				),
				mitigation_timeout: optional(
					picklist(
						RATE_LIMIT_MITIGATION_TIMEOUTS,
						`${prefix}.mitigation_timeout must be one of ${RATE_LIMIT_MITIGATION_TIMEOUTS.join(', ')} seconds`,
					),
					DEFAULT_RATE_LIMIT_MITIGATION_TIMEOUT,
				),
			},
			`[${prefix}] must be a table`,
		),
	)
}

const limitsSchema = (
	name: string,
): GenericSchema<unknown, ParsedLimits | undefined> => {
	const prefix = `deploy.services.${name}.limits`
	return optional(
		object(
			{
				cpu_ms: optional(
					positiveInteger(
						`${prefix}.cpu_ms must be a positive integer`,
					),
				),
				subrequests: optional(
					positiveInteger(
						`${prefix}.subrequests must be a positive integer`,
					),
				),
			},
			`[${prefix}] must be a table`,
		),
	)
}

const hasDistinctNames = (limiters: ParsedRateLimiter[]): boolean =>
	new Set(limiters.map(limiter => limiter.name)).size === limiters.length

const rateLimitersSchema = (
	name: string,
): GenericSchema<unknown, ParsedRateLimiter[] | undefined> => {
	const prefix = `deploy.services.${name}.rate_limiters`
	return optional(
		pipe(
			array(
				object(
					{
						name: pipe(
							string(
								`${prefix} name must be lowercase alphanumeric with dashes only`,
							),
							regex(
								KEBAB_IDENTIFIER_PATTERN,
								`${prefix} name must be lowercase alphanumeric with dashes only`,
							),
						),
						limit: positiveInteger(
							`${prefix} limit must be a positive integer`,
						),
						period: picklist(
							RATE_LIMITER_PERIODS,
							`${prefix} period must be 10 or 60 seconds (the only periods a Rate Limit binding accepts)`,
						),
					},
					`[[${prefix}]] entries must be tables`,
				),
				`${prefix} must be an array of tables`,
			),
			check(
				hasDistinctNames,
				`${prefix} must not declare two limiters named the same - each name becomes one RL_<NAME> binding`,
			),
		),
	)
}

// The four barrier fields a Worker may declare, as valibot entries spliced into
// the worker service schema. `public_paths` carries no default: absent means "no
// firewall rule", empty means "every path blocked".
export const workerFirewallFields = (
	name: string,
): {
	rate_limit: GenericSchema<unknown, ParsedRateLimit | undefined>
	public_paths: GenericSchema<unknown, string[] | undefined>
	limits: GenericSchema<unknown, ParsedLimits | undefined>
	rate_limiters: GenericSchema<unknown, ParsedRateLimiter[] | undefined>
} => ({
	rate_limit: rateLimitSchema(name),
	public_paths: optional(pathArray(`deploy.services.${name}.public_paths`)),
	limits: limitsSchema(name),
	rate_limiters: rateLimitersSchema(name),
})

type WorkerFirewallFields = Pick<
	WorkerServiceConfig,
	'rateLimit' | 'publicPaths' | 'limits' | 'rateLimiters'
>

type WorkerFirewallDraft = {
	-readonly [K in keyof WorkerFirewallFields]?: WorkerFirewallFields[K]
}

function toRateLimit(parsed: ParsedRateLimit): WorkerRateLimitConfig {
	return {
		paths: parsed.paths,
		requestsPerPeriod: parsed.requests_per_period,
		period: parsed.period,
		mitigationTimeout: parsed.mitigation_timeout,
		...(parsed.methods && { methods: parsed.methods }),
	}
}

function toLimits(parsed: ParsedLimits): WorkerLimitsConfig {
	return {
		...(typeof parsed.cpu_ms !== 'undefined' && { cpuMs: parsed.cpu_ms }),
		...(typeof parsed.subrequests !== 'undefined' && {
			subrequests: parsed.subrequests,
		}),
	}
}

// snake_case TOML to camelCase config, dropping every key the file did not
// declare: an absent barrier must stay absent, since the generators read
// presence (not a default) to decide whether to emit anything.
export function toWorkerFirewall(
	parsed: ParsedWorkerFirewall,
): WorkerFirewallDraft {
	const fields: WorkerFirewallDraft = {}
	if (parsed.rate_limit) fields.rateLimit = toRateLimit(parsed.rate_limit)
	if (parsed.public_paths) fields.publicPaths = parsed.public_paths
	if (parsed.limits) fields.limits = toLimits(parsed.limits)
	if (parsed.rate_limiters) fields.rateLimiters = parsed.rate_limiters
	return fields
}
