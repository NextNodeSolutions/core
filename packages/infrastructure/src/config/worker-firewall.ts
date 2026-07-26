// The four barriers a cloudflare-workers project declares around a Worker: the
// upstream ceiling (a zone rate limiting rule), the public gate (a zone custom
// rule over the paths it names), the per-invocation ceilings, and the in-Worker
// rate limiter. Everything here is vocabulary the loaded config carries; what is
// emitted from it lives in the workers domain.

const TEN_SECONDS = 10
const ONE_MINUTE = 60
const TWO_MINUTES = 120
const FIVE_MINUTES = 300
const TEN_MINUTES = 600
const ONE_HOUR = 3600
const ONE_DAY = 86400

// The counting periods (seconds) a zone rate limiting rule accepts, and the
// mitigation timeouts (seconds) it blocks for once the threshold is crossed.
// Both sets are closed by the Cloudflare ruleset API - a value outside them is
// rejected at apply, so it is rejected at load instead.
export const RATE_LIMIT_PERIODS = [
	TEN_SECONDS,
	ONE_MINUTE,
	TWO_MINUTES,
	FIVE_MINUTES,
	TEN_MINUTES,
	ONE_HOUR,
] as const
export type RateLimitPeriod = (typeof RATE_LIMIT_PERIODS)[number]

export const RATE_LIMIT_MITIGATION_TIMEOUTS = [
	0,
	TEN_SECONDS,
	ONE_MINUTE,
	TWO_MINUTES,
	FIVE_MINUTES,
	TEN_MINUTES,
	ONE_HOUR,
	ONE_DAY,
] as const
export type RateLimitMitigationTimeout =
	(typeof RATE_LIMIT_MITIGATION_TIMEOUTS)[number]

export const DEFAULT_RATE_LIMIT_PERIOD: RateLimitPeriod = ONE_MINUTE
export const DEFAULT_RATE_LIMIT_MITIGATION_TIMEOUT: RateLimitMitigationTimeout =
	TEN_MINUTES

// The counting periods a Rate Limit BINDING accepts - the in-Worker limiter is
// a different product from the zone rule and takes only these two.
export const RATE_LIMITER_PERIODS = [TEN_SECONDS, ONE_MINUTE] as const
export type RateLimiterPeriod = (typeof RATE_LIMITER_PERIODS)[number]

export const HTTP_METHODS = [
	'GET',
	'HEAD',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
	'OPTIONS',
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

// The upstream ceiling: a zone rate limiting rule that blocks a burst at
// Cloudflare's edge, BEFORE the Worker is invoked and therefore before it is
// billed. `paths` are request paths (exact, or a trailing `*` for a prefix);
// `methods` narrows the rule further and is omitted when every method counts.
export interface WorkerRateLimitConfig {
	readonly paths: ReadonlyArray<string>
	readonly methods?: ReadonlyArray<HttpMethod>
	readonly requestsPerPeriod: number
	readonly period: RateLimitPeriod
	readonly mitigationTimeout: RateLimitMitigationTimeout
}

// Per-invocation ceilings written into the generated wrangler config. Both
// fields are overrides: the defaults live with the wrangler document, so an
// omitted field keeps the infra-held default rather than disabling the limit.
export interface WorkerLimitsConfig {
	readonly cpuMs?: number
	readonly subrequests?: number
}

// A named Rate Limit binding the Worker reads as `env.RL_<NAME>`. It runs
// INSIDE the Worker (the request is already billed when it rejects) and counts
// by whatever key the code passes - what it protects is behind the Worker.
export interface WorkerRateLimiterConfig {
	readonly name: string
	readonly limit: number
	readonly period: RateLimiterPeriod
}
