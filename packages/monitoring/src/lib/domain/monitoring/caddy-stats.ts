import { isRecord } from '@/lib/domain/is-record.ts'
import { logsqlQuoted } from '@/lib/domain/monitoring/logsql.ts'

/**
 * Per-host HTTP summary derived from Caddy JSON access logs in
 * VictoriaLogs: request count, the share that returned 5xx, and the p95
 * request duration in seconds. One row per `request.host` seen in the
 * window.
 */
export interface CaddyHostStat {
	readonly host: string
	readonly requests: number
	readonly errorRatio: number
	readonly p95Seconds: number
}

const STATS_WINDOW = '1h'

/**
 * LogsQL producing per-domain request totals, 5xx totals and p95 duration
 * over the window from a VPS's Caddy access logs. Caddy runs once per
 * host (systemd), reverse-proxying every project's vhost, so its access
 * logs are a HOST-level stream keyed by `nn_project` (= the VPS
 * hostname); the per-domain `request.host` rows show each project's
 * traffic. `unpack_json` lifts the Caddy JSON from `_msg` (Vector maps
 * `message -> _msg`); the `logger` filter runs AFTER unpack and matches
 * the `http.log.access.logN` per-server suffix as a prefix regex (a
 * pre-unpack phrase match on the bare name fails because of the suffix).
 */
export const buildCaddyStatsQuery = (vpsName: string): string =>
	[
		`_time:${STATS_WINDOW}`,
		`nn_project:${logsqlQuoted(vpsName)}`,
		'| unpack_json',
		String.raw`| filter logger:~"^http\.log\.access"`,
		'| stats by (request.host)',
		'count() as requests,',
		'count() if (status:>=500) as errors,',
		'quantile(0.95, duration) as p95',
	].join(' ')

const numberField = (record: Record<string, unknown>, key: string): number => {
	const raw = record[key]
	if (typeof raw === 'number') return raw
	if (typeof raw === 'string') {
		const num = Number(raw)
		return Number.isFinite(num) ? num : 0
	}
	return 0
}

/**
 * Parse the newline-delimited JSON rows VictoriaLogs returns for the
 * stats query into per-host summaries, sorted by request volume
 * descending. Blank/unparseable rows are skipped.
 */
export const parseCaddyStats = (body: string): ReadonlyArray<CaddyHostStat> => {
	const stats: Array<CaddyHostStat> = []
	for (const raw of body.split('\n')) {
		const trimmed = raw.trim()
		if (trimmed.length === 0) continue
		const row = safeParseRow(trimmed)
		if (row !== null) stats.push(row)
	}
	return stats.toSorted((a, b) => b.requests - a.requests)
}

const safeParseRow = (raw: string): CaddyHostStat | null => {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null
	const host = parsed['request.host']
	if (typeof host !== 'string') return null
	const requests = numberField(parsed, 'requests')
	const errors = numberField(parsed, 'errors')
	return {
		host,
		requests,
		errorRatio: requests > 0 ? errors / requests : 0,
		p95Seconds: numberField(parsed, 'p95'),
	}
}
