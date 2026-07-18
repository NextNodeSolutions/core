// oxlint-disable no-magic-numbers -- this is a fixtures module: the literals ARE
// the data. Naming every server spec, metric base and offset would bury the
// shape it exists to show. Logic-bearing numbers stay named (see the constants).
import { getEnv } from '@/lib/adapters/env.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { VpsGauges } from '@/lib/adapters/victoria/metrics.ts'
import type { HetznerVps } from '@/lib/domain/hetzner/vps.ts'
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
