import {
	queryVictoriaLogs,
	queryVictoriaMetricsInstant,
} from '@/lib/adapters/victoria/client.ts'
import {
	buildCaddyStatsQuery,
	parseCaddyStats,
} from '@/lib/domain/monitoring/caddy-stats.ts'
import { buildHostMetricExprs } from '@/lib/domain/monitoring/host-metrics.ts'
import {
	buildProjectLogsQuery,
	parseLogLines,
} from '@/lib/domain/monitoring/log-query.ts'
import { parseInstantScalar } from '@/lib/domain/monitoring/promql-response.ts'

import type { CaddyHostStat } from '@/lib/domain/monitoring/caddy-stats.ts'
import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Run the four host-metric instant queries for a VPS in parallel and
 * shape them into a HostMetrics. Each gauge is independent: one failing
 * query does not blank the others - it just leaves that field null.
 */
export const loadHostMetrics = async (
	vpsName: string,
): Promise<HostMetrics> => {
	const exprs = buildHostMetricExprs(vpsName)
	const [cpuPercent, memoryPercent, diskPercent, uptimeSeconds] =
		await Promise.all([
			scalarOrNull(exprs.cpuPercent),
			scalarOrNull(exprs.memoryPercent),
			scalarOrNull(exprs.diskPercent),
			scalarOrNull(exprs.uptimeSeconds),
		])
	return { cpuPercent, memoryPercent, diskPercent, uptimeSeconds }
}

const scalarOrNull = async (expr: string): Promise<number | null> => {
	const payload = await queryVictoriaMetricsInstant(expr)
	return parseInstantScalar(payload)
}

/** Most-recent log lines for a project, newest first. */
export const loadProjectLogs = async (
	project: string,
): Promise<ReadonlyArray<LogLine>> => {
	const body = await queryVictoriaLogs(buildProjectLogsQuery(project))
	return parseLogLines(body)
}

/** Per-host Caddy access summary for a project over the last hour. */
export const loadCaddyStats = async (
	project: string,
): Promise<ReadonlyArray<CaddyHostStat>> => {
	const body = await queryVictoriaLogs(buildCaddyStatsQuery(project))
	return parseCaddyStats(body)
}
