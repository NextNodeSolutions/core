import { beforeAll, describe, expect, it } from 'vitest'

import {
	buildFleetStatsQuery,
	histogramStepSeconds,
	parseFleetStats,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import {
	buildFleetErrorCountQuery,
	buildFleetLogsQuery,
	buildLogFacetsQuery,
	parseLogFacet,
	parseLogLines,
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
	const line = (agoHours: number, level: string, service: string): string =>
		JSON.stringify({
			_time: new Date(now - agoHours * HOUR_MS).toISOString(),
			_msg: JSON.stringify({ level, message: `m-${level}` }),
			nn_project: STREAM,
			nn_service: service,
		})
	const ndjson = [
		line(0.2, 'error', 'app'),
		line(0.5, 'info', 'app'),
		line(3, 'error', 'worker'),
		line(3, 'warn', 'worker'),
		line(3, 'debug', 'app'),
		line(10, 'error', 'app'),
		line(20, 'info', 'worker'),
	].join('\n')
	await fetch(
		`${String(VL_URL)}/insert/jsonline?_time_field=_time&_msg_field=_msg&_stream_fields=nn_project,nn_service`,
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

// Count THIS test's own seeded lines (scoped to its stream), so the readiness
// poll waits for the fixtures to flush even when the instance already holds
// unrelated data - not just any line, which could pass prematurely.
const seededCount = async (): Promise<number> =>
	parseStatsCount(
		await queryVL(
			`_time:24h nn_project:${JSON.stringify(STREAM)} | stats count() as total`,
		),
		'total',
	)

const RETRY_LIMIT = 20
const RETRY_DELAY_MS = 500
const SEEDED_LINES = 7

describe.skipIf(VL_URL === undefined || VL_URL === '')(
	'VictoriaLogs LogsQL (real engine)',
	() => {
		beforeAll(async () => {
			await ingestFixtures()
			// VictoriaLogs makes freshly-ingested data queryable after a short
			// flush; poll until ALL of THIS test's seeded lines are visible.
			for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
				// Polling a flush is inherently sequential (check, then wait).
				// oxlint-disable-next-line no-await-in-loop
				if ((await seededCount()) >= SEEDED_LINES) return
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

		it('accepts buildLogFacetsQuery and returns the window facet values', async () => {
			const services = parseLogFacet(
				await queryVL(buildLogFacetsQuery(24, 'nn_service')),
				'nn_service',
			)
			const vps = parseLogFacet(
				await queryVL(buildLogFacetsQuery(24, 'nn_project')),
				'nn_project',
			)
			expect(services).toEqual(expect.arrayContaining(['app', 'worker']))
			expect(vps).toContain(STREAM)
		})

		it('honours the server-side service/vps filter in the sample + stats', async () => {
			const filter = { service: 'worker', vps: STREAM }
			const workerLines = parseLogLines(
				await queryVL(buildFleetLogsQuery(24, filter)),
			)
			// Every returned line is a worker line (server-filtered, not client).
			expect(workerLines.length).toBeGreaterThan(0)
			expect(workerLines.every(line => line.service === 'worker')).toBe(
				true,
			)

			const workerStats = parseFleetStats(
				await queryVL(
					buildFleetStatsQuery(24, histogramStepSeconds(24), filter),
				),
				{ nowMs: Date.now(), windowMs: windowMsFor(24) },
			)
			const allStats = parseFleetStats(
				await queryVL(
					buildFleetStatsQuery(24, histogramStepSeconds(24)),
				),
				{ nowMs: Date.now(), windowMs: windowMsFor(24) },
			)
			// The facet scope strictly shrinks the windowed total.
			expect(workerStats.total).toBeGreaterThan(0)
			expect(workerStats.total).toBeLessThan(allStats.total)
		})
	},
)
