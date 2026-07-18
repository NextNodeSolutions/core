// oxlint-disable no-magic-numbers -- this is a fixtures module: the literals ARE
// the data. Naming every server spec, metric base and offset would bury the
// shape it exists to show. Logic-bearing numbers stay named (see the constants).
import { getEnv } from '@/lib/adapters/env.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { VpsGauges } from '@/lib/adapters/victoria/metrics.ts'
import type { FleetVps } from '@/lib/domain/monitoring/fleet-vps.ts'
import type {
	HostFacts,
	TrafficTotals,
} from '@/lib/domain/monitoring/host-facts.ts'
import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'
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

const GIB = 2 ** 30

interface MockVpsSpec {
	readonly vps: FleetVps
	readonly facts: HostFacts
}

const MOCK_FLEET_SPECS: ReadonlyArray<MockVpsSpec> = [
	{
		vps: { name: 'nn-prod', isOnline: true, project: 'stylot' },
		facts: {
			cores: 2,
			memoryTotalBytes: 4 * GIB,
			diskTotalBytes: 40 * GIB,
		},
	},
	{
		vps: { name: 'nn-internals', isOnline: true, project: 'monitoring' },
		facts: {
			cores: 4,
			memoryTotalBytes: 8 * GIB,
			diskTotalBytes: 80 * GIB,
		},
	},
	{
		vps: { name: 'nn-staging', isOnline: false, project: null },
		facts: {
			cores: 2,
			memoryTotalBytes: 4 * GIB,
			diskTotalBytes: 40 * GIB,
		},
	},
]

export const mockFleet = (): ReadonlyArray<FleetVps> =>
	MOCK_FLEET_SPECS.map(spec => spec.vps)

export const mockFleetVpsByName = (name: string): FleetVps | null =>
	MOCK_FLEET_SPECS.find(spec => spec.vps.name === name)?.vps ?? null

const NULL_FACTS: HostFacts = {
	cores: null,
	memoryTotalBytes: null,
	diskTotalBytes: null,
}

export const mockHostFacts = (vpsName: string): HostFacts =>
	MOCK_FLEET_SPECS.find(spec => spec.vps.name === vpsName)?.facts ??
	NULL_FACTS

export const mockTrafficTotals = (
	vpsName: string | null,
	windowHours: number,
): TrafficTotals => {
	const seed = seedFromName(vpsName ?? 'fleet')
	const scale = vpsName === null ? MOCK_FLEET_SPECS.length : 1
	return {
		inBytes: (2 + wobble(seed) * 6) * scale * windowHours * GB,
		outBytes: (1 + wobble(seed + 1) * 4) * scale * windowHours * GB,
	}
}

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

// A slow trend keyed off each sample's ABSOLUTE age (rising over the first
// ~48h) is what makes the window MEAN differ by range: a 1h window samples only
// the flat head, a 24h window averages a higher arc. SLOW/FAST weights sum to 1
// so the swing stays within `base ± amp` (no clamp distortion skewing the mean).
const SLOW_TREND_RATE = Math.PI / 24
const SLOW_WEIGHT = 0.6
const FAST_WEIGHT = 0.4

export const mockVpsSeries = (
	vpsName: string,
	metric: VpsSeriesMetric,
	hours: number,
): ReadonlyArray<RangePoint> => {
	const nowSec = Math.floor(Date.now() / 1000)
	// Guard a NaN/Infinity window (the real path clamps via clampNumber; the mock
	// branch returns before that, so guard here) so points never become NaN.
	const windowHours = Number.isFinite(hours)
		? Math.max(MIN_WINDOW_HOURS, hours)
		: 1
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
