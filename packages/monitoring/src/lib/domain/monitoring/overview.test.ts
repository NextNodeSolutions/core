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
		errorCount: 0,
		notices: [],
	}

	it('shows the provided WINDOWED error count, not a tally of the preview sample', () => {
		// The preview `logs` carry only 2 error lines (the capped display
		// sample), but the windowed aggregate counted 47 over the whole range.
		// The stat must reflect the aggregate, never re-count the sample.
		const window = buildOverviewWindow({
			...base,
			errorCount: 47,
			logs: [
				logLine({ level: 'error' }),
				logLine({ level: 'warn' }),
				logLine({ level: 'error' }),
				logLine({ level: 'info' }),
			],
		})
		const errors = window.stats.find(s => s.label === 'Erreurs (6 h)')
		expect(errors).toMatchObject({ value: '47', tone: 'danger' })
	})

	it('marks the error stat positive when the windowed count is zero', () => {
		const window = buildOverviewWindow({
			...base,
			errorCount: 0,
			logs: [logLine({ level: 'error' })], // sample has an error; window had none
		})
		const errors = window.stats.find(s => s.label === 'Erreurs (6 h)')
		expect(errors).toMatchObject({ value: '0', tone: 'positive' })
	})

	it('derives the windowed CPU average from the series, labelled by window', () => {
		const window = buildOverviewWindow({ ...base, logs: [] })
		const cpu = window.stats.find(s => s.label === 'CPU moyen (6 h)')
		expect(cpu).toMatchObject({ value: '20%', hint: '1 nœud' })
	})

	it('labels a sub-hour live window in minutes, not "0 h"', () => {
		const window = buildOverviewWindow({
			...base,
			windowHours: 5 / 60,
			errorCount: 3,
			logs: [],
		})
		expect(window.stats.map(stat => stat.label)).toEqual(
			expect.arrayContaining(['CPU moyen (5 min)', 'Erreurs (5 min)']),
		)
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
