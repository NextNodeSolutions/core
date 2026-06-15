import { buildHostMetricExprs } from '@/lib/domain/monitoring/host-metrics.ts'

import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'

const METRIC_KEYS = [
	'cpuPercent',
	'memoryPercent',
	'diskPercent',
	'uptimeSeconds',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

const DEFAULT_HOURS = 1
// 30 days, the metrics view's longest meaningful window.
const MAX_HOURS = 720
const SECONDS_PER_HOUR = 3600
const STEP_BUCKETS = 120

export interface MetricRangeRequest {
	readonly expr: string
	readonly startSeconds: number
	readonly endSeconds: number
	readonly stepSeconds: number
}

/**
 * Window + step for a range query over the last `hours`, ending now. Shared
 * by the validated metric proxy and the VPS series loader so both bucket the
 * window identically (STEP_BUCKETS points). `nowSeconds` is injected to stay
 * pure.
 */
export const buildMetricRangeWindow = (
	hours: number,
	nowSeconds: number,
): Omit<MetricRangeRequest, 'expr'> => {
	const windowSeconds = Math.round(hours * SECONDS_PER_HOUR)
	return {
		startSeconds: nowSeconds - windowSeconds,
		endSeconds: nowSeconds,
		stepSeconds: Math.max(1, Math.round(windowSeconds / STEP_BUCKETS)),
	}
}

const isMetricKey = (candidate: string | null): candidate is MetricKey =>
	candidate !== null && METRIC_KEYS.some(key => key === candidate)

/**
 * Validate a metric-range request from query params into a bounded
 * VictoriaMetrics range query. Rejects an unknown metric key (only the
 * four host gauges are exposed - no arbitrary PromQL passthrough) and an
 * out-of-range window. `nowSeconds` is injected so the function stays
 * pure and testable.
 *
 * Returns a discriminated result rather than throwing: the route maps
 * `invalid` to a 400.
 */
export const parseMetricRangeRequest = (
	args: {
		readonly vpsName: string
		readonly metric: string | null
		readonly hours: string | null
	},
	nowSeconds: number,
):
	| { readonly ok: true; readonly request: MetricRangeRequest }
	| { readonly ok: false; readonly error: string } => {
	if (!isMetricKey(args.metric)) {
		return {
			ok: false,
			error: `metric must be one of: ${METRIC_KEYS.join(', ')}`,
		}
	}
	const hours = args.hours === null ? DEFAULT_HOURS : Number(args.hours)
	if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
		return {
			ok: false,
			error: `hours must be a number in (0, ${String(MAX_HOURS)}]`,
		}
	}
	const exprs: Readonly<Record<keyof HostMetrics, string>> =
		buildHostMetricExprs(args.vpsName)
	return {
		ok: true,
		request: {
			expr: exprs[args.metric],
			...buildMetricRangeWindow(hours, nowSeconds),
		},
	}
}
