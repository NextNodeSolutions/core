// oxlint-disable no-magic-numbers -- this is a fixtures module: the literals ARE
// the data. Naming every server spec, metric base and offset would bury the
// shape it exists to show. Logic-bearing numbers stay named (see the constants).
import { getEnv } from '@/lib/adapters/env.ts'
import {
	fleetStatsFromLogs,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { VpsGauges } from '@/lib/adapters/victoria/metrics.ts'
import type { HetznerVps } from '@/lib/domain/hetzner/vps.ts'
import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'
import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'
import type { VpsSeriesMetric } from '@/lib/domain/monitoring/vps-metrics.ts'

/**
 * Local-only mock data. With `MOCK_DATA=1` the upstream adapters short-circuit
 * to these fixtures instead of hitting Hetzner / VictoriaMetrics / VictoriaLogs,
 * so the whole dashboard renders fully populated with no tokens and no tailnet -
 * the fast, offline way to iterate on the UI. Deterministic (no RNG, seeded off
 * names/indices) so a reload looks identical. Never on in production: the flag
 * defaults off and lives only in a local `.env`.
 */

/** Truthy only for `MOCK_DATA=1` / `MOCK_DATA=true`. */
export const MOCK_DATA = ['1', 'true'].includes(getEnv('MOCK_DATA') ?? '')

const SECONDS_PER_HOUR = 3600
const SERIES_POINTS = 60
const GB = 1_000_000_000

/** Stable 0..1 pseudo-noise from a seed - keeps reloads identical (no RNG). */
const wobble = (seed: number): number => (Math.sin(seed * 12.9898) + 1) / 2

const seedFromName = (name: string): number =>
	Array.from(name, ch => ch.charCodeAt(0)).reduce(
		(sum, code) => sum + code,
		0,
	)

interface MockServerSpec {
	readonly id: number
	readonly name: string
	readonly type: {
		name: string
		cores: number
		memoryGb: number
		diskGb: number
	}
	readonly ipv4: string
	readonly role: string
}

const server = (spec: MockServerSpec): HetznerVps => ({
	id: spec.id,
	name: spec.name,
	status: 'running',
	ipv4: spec.ipv4,
	ipv6: null,
	serverType: {
		name: spec.type.name,
		description: spec.type.name.toUpperCase(),
		cores: spec.type.cores,
		memoryGb: spec.type.memoryGb,
		diskGb: spec.type.diskGb,
		cpuType: 'shared',
		architecture: 'x86',
	},
	location: {
		name: 'fsn1',
		city: 'Falkenstein',
		country: 'DE',
		datacenter: 'fsn1-dc14',
	},
	image: 'nextnode-golden-5ff278206c07a66a',
	createdAt: '2026-01-12T09:30:00Z',
	labels: { role: spec.role },
	traffic: {
		ingoingBytes: 2_000 * GB,
		outgoingBytes: (500 + spec.id * 90) * GB,
		includedBytes: 20_000 * GB,
	},
	protection: { delete: false, rebuild: false },
	backupsEnabled: spec.id % 2 === 0,
	locked: false,
	volumeCount: 0,
})

const MOCK_SERVERS: ReadonlyArray<HetznerVps> = [
	server({
		id: 1,
		name: 'nn-prod',
		type: { name: 'cx23', cores: 2, memoryGb: 4, diskGb: 40 },
		ipv4: '46.225.126.135',
		role: 'prod',
	}),
	server({
		id: 2,
		name: 'nn-internals',
		type: { name: 'cx33', cores: 4, memoryGb: 8, diskGb: 80 },
		ipv4: '46.225.126.201',
		role: 'internal',
	}),
	server({
		id: 3,
		name: 'nn-staging',
		type: { name: 'cx23', cores: 2, memoryGb: 4, diskGb: 40 },
		ipv4: '46.225.126.88',
		role: 'staging',
	}),
]

export const mockServers = (): ReadonlyArray<HetznerVps> => MOCK_SERVERS

export const mockServerByName = (name: string): HetznerVps | null =>
	MOCK_SERVERS.find(vps => vps.name === name) ?? null

export const mockHostMetrics = (vpsName: string): HostMetrics => {
	const seed = seedFromName(vpsName)
	return {
		cpuPercent: 12 + wobble(seed) * 46,
		memoryPercent: 28 + wobble(seed + 1) * 40,
		diskPercent: 22 + wobble(seed + 2) * 34,
		uptimeSeconds: 540_000 + seed * 4_321,
	}
}

export const mockVpsGauges = (vpsName: string): VpsGauges => {
	const seed = seedFromName(vpsName)
	return {
		load1: Number((wobble(seed) * 1.4).toFixed(2)),
		load5: Number((wobble(seed + 1) * 1.2).toFixed(2)),
		load15: Number((wobble(seed + 2) * 1.0).toFixed(2)),
		swapPercent: Number((wobble(seed + 3) * 8).toFixed(1)),
		netInMbps: Number((wobble(seed + 4) * 12).toFixed(1)),
		netOutMbps: Number((wobble(seed + 5) * 9).toFixed(1)),
	}
}

const SERIES_SHAPE: Record<VpsSeriesMetric, { base: number; amp: number }> = {
	cpu: { base: 32, amp: 22 },
	mem: { base: 46, amp: 14 },
	disk: { base: 38, amp: 6 },
	netIn: { base: 6, amp: 5 },
	netOut: { base: 4, amp: 4 },
	diskIo: { base: 3, amp: 3 },
	diskLatency: { base: 2, amp: 2 },
	load: { base: 0.6, amp: 0.5 },
}

// A slow trend keyed off each sample's ABSOLUTE age in hours, rising across the
// first ~48h (half a sine cycle). This is what makes the window MEAN differ by
// range: a 1h window samples only the flat head of the curve, a 24h window
// averages a much larger, higher arc. Without an age-dependent term the mean of
// every window was identical, so "CPU moyen" never moved when the range
// changed. SLOW/FAST weights sum to 1 so the swing stays within `base ± amp`
// (no clamp distortion that would skew the mean).
const SLOW_TREND_RATE = Math.PI / 24
const SLOW_WEIGHT = 0.6
const FAST_WEIGHT = 0.4

export const mockVpsSeries = (
	vpsName: string,
	metric: VpsSeriesMetric,
	hours: number,
): ReadonlyArray<RangePoint> => {
	const nowSec = Math.floor(Date.now() / 1000)
	const windowHours = Math.max(MIN_WINDOW_HOURS, hours)
	const span = windowHours * SECONDS_PER_HOUR
	const step = span / SERIES_POINTS
	const shape = SERIES_SHAPE[metric]
	const seed = seedFromName(vpsName + metric)
	return Array.from({ length: SERIES_POINTS }, (_, index) => {
		// index 0 is the oldest sample (now - span); the last is ~now. The slow
		// trend reads the sample's absolute age so wider windows reach higher up
		// the curve; the fast term is pure per-point texture (mean ~0). Neither
		// uses the wall clock, so the VALUES are reload-stable.
		const ageHours =
			((SERIES_POINTS - 1 - index) / SERIES_POINTS) * windowHours
		const sample =
			shape.base +
			Math.sin(ageHours * SLOW_TREND_RATE) * shape.amp * SLOW_WEIGHT +
			Math.sin(index / 6 + seed) * shape.amp * FAST_WEIGHT +
			wobble(seed + index) * (shape.amp / 4)
		return {
			t: Math.floor(nowSec - span + index * step),
			v: Math.max(0, sample),
		}
	})
}

const SERVICES = ['app', 'api', 'caddy', 'worker', 'cron'] as const
const VPS_NAMES = ['nn-prod', 'nn-internals', 'nn-staging'] as const
const LINES: ReadonlyArray<{ level: LogLine['level']; message: string }> = [
	{ level: 'info', message: 'GET /api/health 200 in 4ms' },
	{ level: 'info', message: 'request completed' },
	{ level: 'warn', message: 'slow query: 812ms on projects.list' },
	{ level: 'error', message: 'upstream timeout reaching cloudflare api' },
	{ level: 'info', message: 'cache hit ratio 0.93' },
	{ level: 'debug', message: 'scheduler tick: 3 jobs enqueued' },
	{ level: 'info', message: 'deploy webhook accepted' },
	{ level: 'warn', message: 'memory pressure 78% on container' },
	{ level: 'error', message: 'ECONNRESET while streaming logs' },
	{ level: 'info', message: 'POST /api/overview 200 in 21ms' },
	{ level: 'debug', message: 'jwt verified for operator session' },
	{ level: 'info', message: 'background backup completed (1.2 GB)' },
]

const MS_PER_HOUR = 3_600_000
const MOCK_LOG_LINES_PER_HOUR = 8
// Low floor so the 5-minute live window shows FEWER lines (and errors) than the
// 1h window - the whole point of making `live` a distinct short window.
const MIN_MOCK_LOG_LINES = 2
const MAX_MOCK_LOG_LINES = 240
const DEFAULT_MOCK_LOG_HOURS = 6

/**
 * How many synthetic lines a `windowHours` window holds: more time -> more logs
 * (and proportionally more errors), so the windowed overview stats and the logs
 * histogram actually MOVE when the range changes. Clamped at both ends so even
 * a 24h window stays light enough for instant client-side filtering.
 */
const mockLogCount = (windowHours: number): number =>
	Math.min(
		MAX_MOCK_LOG_LINES,
		Math.max(
			MIN_MOCK_LOG_LINES,
			Math.round(
				Math.max(MIN_WINDOW_HOURS, windowHours) *
					MOCK_LOG_LINES_PER_HOUR,
			),
		),
	)

/**
 * Synthetic fleet logs for `windowHours`, newest first. The line count scales
 * with the window and timestamps are spread ACROSS it (not clustered in the
 * last few minutes), so a range change visibly changes the error count and
 * redraws the histogram. Content cycles deterministically through `LINES`.
 */
export const mockFleetLogs = (
	windowHours: number = DEFAULT_MOCK_LOG_HOURS,
): ReadonlyArray<LogLine> => {
	const nowMs = Date.now()
	const windowMs = Math.max(MIN_WINDOW_HOURS, windowHours) * MS_PER_HOUR
	const count = mockLogCount(windowHours)
	return Array.from({ length: count }, (_, index) => {
		const line = LINES[index % LINES.length] ?? {
			level: 'info' as const,
			message: '',
		}
		// index 0 = newest; the +0.5 offset keeps even the freshest line a few
		// minutes old, so it never lands ahead of the page's injected `now`.
		const ageMs = ((index + 0.5) / count) * windowMs
		return {
			time: new Date(nowMs - ageMs).toISOString(),
			message: line.message,
			container: null,
			level: line.level,
			service: SERVICES[index % SERVICES.length] ?? null,
			vps: VPS_NAMES[index % VPS_NAMES.length] ?? null,
			status: null,
			method: null,
			path: null,
			durationMs: null,
			traceId: null,
			stack: null,
			meta: {},
		}
	})
}

export const mockVpsLogs = (vpsName: string): ReadonlyArray<LogLine> => {
	const own = mockFleetLogs().filter(line => line.vps === vpsName)
	return own.length > 0 ? own : mockFleetLogs()
}

/**
 * Windowed fleet error tally - the offline stand-in for the real
 * `stats count()` query, NOT a count of the 200-line display sample. Derived
 * from `mockFleetLogs(windowHours)`, whose line count scales with the window,
 * so it MOVES as the range changes (the whole point of the fix).
 */
export const mockFleetErrorCount = (
	windowHours: number = DEFAULT_MOCK_LOG_HOURS,
): number =>
	mockFleetLogs(windowHours).filter(line => line.level === 'error').length

/**
 * Windowed /logs aggregates for offline mode - the stand-in for the real
 * `stats by (_time:step, level)` query. Built from the SAME window-scaled,
 * window-spread `mockFleetLogs`, so the histogram redraws and the level/total
 * counts move as the range changes (exactly what the fix must demonstrate).
 */
export const mockFleetStats = (
	windowHours: number,
	nowMs: number,
): FleetLogStats =>
	fleetStatsFromLogs(mockFleetLogs(windowHours), {
		nowMs,
		windowMs: windowMsFor(windowHours),
	})
