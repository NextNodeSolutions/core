import { describe, expect, it } from 'vitest'

import { buildOverviewWindow, OVERVIEW_STREAM_COUNT } from './overview.ts'

import type { HetznerVps } from '@/lib/domain/hetzner/vps.ts'
import type { ServerMetrics } from './fleet-overview.ts'
import type { LogLine } from './log-query.ts'

const GB = 1_000_000_000

const server = (name: string): HetznerVps => ({
	id: 1,
	name,
	status: 'running',
	ipv4: null,
	ipv6: null,
	serverType: {
		name: 'cax21',
		description: 'CAX21',
		cores: 4,
		memoryGb: 8,
		diskGb: 80,
		cpuType: 'shared',
		architecture: 'arm',
	},
	location: {
		name: 'fsn1',
		city: 'Falkenstein',
		country: 'DE',
		datacenter: null,
	},
	image: 'debian-12',
	createdAt: '2026-01-01T00:00:00Z',
	labels: {},
	traffic: {
		ingoingBytes: 0,
		outgoingBytes: 500 * GB,
		includedBytes: 20_000 * GB,
	},
	protection: { delete: false, rebuild: false },
	backupsEnabled: false,
	locked: false,
	volumeCount: 0,
})

const metrics = (cpu: number | null): ServerMetrics => ({
	cpuPercent: cpu,
	memoryPercent: 30,
	diskPercent: 40,
})

const logLine = (overrides: Partial<LogLine>): LogLine => ({
	time: '2026-06-19T10:00:00Z',
	message: 'hello',
	container: null,
	level: 'info',
	service: 'api',
	vps: 'alpha',
	status: null,
	method: null,
	path: null,
	durationMs: null,
	traceId: null,
	stack: null,
	meta: {},
	...overrides,
})

describe('buildOverviewWindow', () => {
	const base = {
		range: '6h',
		windowHours: 6,
		servers: [server('alpha')],
		metricsByName: { alpha: metrics(20) } satisfies Record<
			string,
			ServerMetrics
		>,
		cpuSeriesByServer: [[10, 30]], // mean 20
		notices: [],
	}

	it('counts only error-level lines for the error stat', () => {
		const window = buildOverviewWindow({
			...base,
			logs: [
				logLine({ level: 'error' }),
				logLine({ level: 'warn' }),
				logLine({ level: 'error' }),
				logLine({ level: 'info' }),
			],
		})
		const errors = window.stats.find(s => s.label === 'Erreurs (6 h)')
		expect(errors).toMatchObject({ value: '2', tone: 'danger' })
	})

	it('derives the windowed CPU average from the series, labelled by window', () => {
		const window = buildOverviewWindow({ ...base, logs: [] })
		const cpu = window.stats.find(s => s.label === 'CPU moyen (6 h)')
		expect(cpu).toMatchObject({ value: '20%', hint: '1 nœud' })
	})

	it('caps the stream at OVERVIEW_STREAM_COUNT, newest-first as given', () => {
		const logs = Array.from({ length: 12 }, (_, index) =>
			logLine({ message: `line-${String(index)}` }),
		)
		const window = buildOverviewWindow({ ...base, logs })
		expect(window.stream).toHaveLength(OVERVIEW_STREAM_COUNT)
		expect(window.stream[0]?.message).toBe('line-0')
		// Each line carries a stable, unique key for React.
		const keys = new Set(window.stream.map(line => line.key))
		expect(keys.size).toBe(OVERVIEW_STREAM_COUNT)
	})

	it('passes notices through untouched', () => {
		const notices = [
			{ section: 'logs', label: 'VictoriaLogs', message: 'HTTP 0' },
		]
		const window = buildOverviewWindow({ ...base, logs: [], notices })
		expect(window.notices).toEqual(notices)
	})
})
