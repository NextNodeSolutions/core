import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'

/**
 * Compose-network base URLs of the observability backend. The monitoring
 * app and the VictoriaMetrics/VictoriaLogs containers share one compose
 * project (the `[services.observability]` stack is injected into this
 * project's compose file), so the service names resolve over the
 * internal docker network. These are a hard contract of the
 * observability stack (the compose service names + upstream default
 * ports), not configuration - never a host port, never the public IP,
 * the queries stay inside the compose bridge. In local dev the stack is
 * unreachable and the panels degrade to an upstream-error banner.
 */
const VICTORIAMETRICS_URL = 'http://victoriametrics:8428'
const VICTORIALOGS_URL = 'http://victorialogs:9428'

/** Bound every query so a hung backend cannot wedge a page render. */
const QUERY_TIMEOUT_MS = 5000

/** Cap the upstream body echoed into structured logs. */
const MAX_LOGGED_BODY = 500

export class VictoriaApiFailure extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly body: string,
	) {
		super(context, httpStatus, `${context}: HTTP ${String(httpStatus)}`)
	}

	logContext(): Record<string, unknown> {
		return { body: this.body.slice(0, MAX_LOGGED_BODY) }
	}
}

const fetchWithTimeout = async (
	url: string,
	context: string,
): Promise<Response> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)
	try {
		return await fetch(url, { signal: controller.signal })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// A connection refused / abort is an upstream failure, surfaced as
		// a degraded panel rather than a 500 page.
		throw new VictoriaApiFailure(context, 0, message)
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Run an instant PromQL query against VictoriaMetrics. Returns the raw
 * decoded JSON; the domain parser shapes it. The query travels in the
 * URL (GET) so it is cache-friendly and idempotent.
 */
export const queryVictoriaMetricsInstant = async (
	expr: string,
): Promise<unknown> => {
	const url = `${VICTORIAMETRICS_URL}/api/v1/query?query=${encodeURIComponent(expr)}`
	const response = await fetchWithTimeout(
		url,
		'victoriametrics instant query',
	)
	if (!response.ok) {
		throw new VictoriaApiFailure(
			'victoriametrics instant query',
			response.status,
			await response.text(),
		)
	}
	return response.json()
}

export interface RangeQueryArgs {
	readonly expr: string
	readonly startSeconds: number
	readonly endSeconds: number
	readonly stepSeconds: number
}

/** Run a range PromQL query - powers the time-series proxy endpoint. */
export const queryVictoriaMetricsRange = async (
	args: RangeQueryArgs,
): Promise<unknown> => {
	const params = new URLSearchParams({
		query: args.expr,
		start: String(args.startSeconds),
		end: String(args.endSeconds),
		step: String(args.stepSeconds),
	})
	const url = `${VICTORIAMETRICS_URL}/api/v1/query_range?${params.toString()}`
	const response = await fetchWithTimeout(url, 'victoriametrics range query')
	if (!response.ok) {
		throw new VictoriaApiFailure(
			'victoriametrics range query',
			response.status,
			await response.text(),
		)
	}
	return response.json()
}

/**
 * Run a LogsQL query against VictoriaLogs, returning the raw
 * newline-delimited JSON body for the domain parser. The
 * `/select/logsql/query` endpoint streams one JSON object per line.
 */
export const queryVictoriaLogs = async (logsql: string): Promise<string> => {
	const url = `${VICTORIALOGS_URL}/select/logsql/query?query=${encodeURIComponent(logsql)}`
	const response = await fetchWithTimeout(url, 'victorialogs query')
	if (!response.ok) {
		throw new VictoriaApiFailure(
			'victorialogs query',
			response.status,
			await response.text(),
		)
	}
	return response.text()
}
