import { beforeAll, describe, expect, it } from 'vitest'

import {
	buildFleetStatsQuery,
	histogramStepSeconds,
	parseFleetStats,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import {
	buildFleetErrorCountQuery,
	parseStatsCount,
} from '@/lib/domain/monitoring/log-query.ts'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'

/**
 * REAL-ENGINE integration test for the windowed log-stats LogsQL.
 *
 * The unit tests pin the query STRINGS and the parsers, but a stub can never
 * tell us whether VictoriaLogs actually ACCEPTS the LogsQL - only a real engine
 * can. This test runs the exact `buildFleet*Query` output against a live
 * VictoriaLogs, so a syntax regression (e.g. `stats by (_time:step, level)`,
 * `count() if (...)`, the `(?i)` regex, the RFC3339 `_time` the parser assumes)
 * fails here instead of silently on the tailnet at deploy.
 *
 * Skipped unless VICTORIALOGS_TEST_URL points at a FRESH/dedicated VictoriaLogs
 * (so `pnpm test` stays fast and offline). To run locally:
 *
 *   # one static binary, no Docker, no tailnet:
 *   curl -sL -o vl.tgz https://github.com/VictoriaMetrics/VictoriaLogs/releases/latest/download/victoria-logs-darwin-arm64.tar.gz
 *   tar xzf vl.tgz && ./victoria-logs-prod -httpListenAddr=127.0.0.1:9428 &
 *   VICTORIALOGS_TEST_URL=http://127.0.0.1:9428 pnpm test logs.integration
 *
 * Assertions are window-MONOTONIC (1h < 6h < 24h), not absolute, so re-running
 * against the same instance (which re-ingests the same relative-time fixtures)
 * stays correct.
 */

const VL_URL = process.env.VICTORIALOGS_TEST_URL
const HOUR_MS = 3_600_000
const STREAM = 'monitoring-it'

const queryVL = async (logsql: string): Promise<string> => {
	const response = await fetch(`${String(VL_URL)}/select/logsql/query`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ query: logsql }).toString(),
	})
	if (!response.ok) {
		throw new Error(
			`VL ${String(response.status)}: ${await response.text()}`,
		)
	}
	return response.text()
}

// `level` lives INSIDE `_msg` as a JSON blob, exactly as Vector ships the app's
// logs - so the queries must `unpack_json` to see it. Spread across 24h so the
// window filter has something to bite on: errors land at 0.2h / 3h / 10h ago.
const ingestFixtures = async (): Promise<void> => {
	const now = Date.now()
	const line = (agoHours: number, level: string): string =>
		JSON.stringify({
			_time: new Date(now - agoHours * HOUR_MS).toISOString(),
			_msg: JSON.stringify({ level, message: `m-${level}` }),
			nn_project: STREAM,
		})
	const ndjson = [
		line(0.2, 'error'),
		line(0.5, 'info'),
		line(3, 'error'),
		line(3, 'warn'),
		line(3, 'debug'),
		line(10, 'error'),
		line(20, 'info'),
	].join('\n')
	await fetch(
		`${String(VL_URL)}/insert/jsonline?_time_field=_time&_msg_field=_msg&_stream_fields=nn_project`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-ndjson' },
			body: ndjson,
		},
	)
}

const errorCountForWindow = async (windowHours: number): Promise<number> =>
	parseStatsCount(
		await queryVL(buildFleetErrorCountQuery(windowHours)),
		'errors',
	)

const RETRY_LIMIT = 20
const RETRY_DELAY_MS = 500

describe.skipIf(VL_URL === undefined || VL_URL === '')(
	'VictoriaLogs LogsQL (real engine)',
	() => {
		beforeAll(async () => {
			await ingestFixtures()
			// VictoriaLogs makes freshly-ingested data queryable after a short
			// flush; poll until the error tally is non-zero before asserting.
			for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
				// Polling a flush is inherently sequential (check, then wait).
				// oxlint-disable-next-line no-await-in-loop
				if ((await errorCountForWindow(24)) > 0) return
				// oxlint-disable-next-line no-await-in-loop
				await new Promise(resolve =>
					setTimeout(resolve, RETRY_DELAY_MS),
				)
			}
			throw new Error('ingested fixtures never became queryable')
		}, 20_000)

		it('accepts buildFleetErrorCountQuery and tracks the window', async () => {
			const [oneHour, sixHours, oneDay] = await Promise.all([
				errorCountForWindow(1),
				errorCountForWindow(6),
				errorCountForWindow(24),
			])
			expect(oneHour).toBeGreaterThan(0)
			expect(oneHour).toBeLessThan(sixHours)
			expect(sixHours).toBeLessThan(oneDay)
		})

		it('accepts buildFleetStatsQuery and returns RFC3339-bucketed level rows', async () => {
			const statsFor = async (
				windowHours: number,
			): Promise<FleetLogStats> => {
				const body = await queryVL(
					buildFleetStatsQuery(
						windowHours,
						histogramStepSeconds(windowHours),
					),
				)
				return parseFleetStats(body, {
					nowMs: Date.now(),
					windowMs: windowMsFor(windowHours),
				})
			}
			const sixHours = await statsFor(6)
			const oneDay = await statsFor(24)

			// The stats parsed cleanly (so `_time` was RFC3339 as parseFleetStats
			// assumes, `level` was unpacked, `as hits` named the count column).
			expect(sixHours.buckets).toHaveLength(72)
			expect(sixHours.levelCounts.error).toBeGreaterThan(0)
			expect(sixHours.levelCounts.info).toBeGreaterThan(0)
			expect(sixHours.total).toBeGreaterThan(0)
			// At least one error landed in a bucket (the histogram is populated).
			expect(sixHours.buckets.some(bucket => bucket.error > 0)).toBe(true)
			// Wider window aggregates strictly more lines.
			expect(oneDay.total).toBeGreaterThan(sixHours.total)
		})
	},
)
