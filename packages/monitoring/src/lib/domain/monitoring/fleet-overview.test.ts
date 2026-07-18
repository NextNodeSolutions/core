import { describe, expect, it } from 'vitest'

import {
	computeServerHealth,
	deriveFleetAlerts,
	fleetCpuWindowAverage,
	summarizeFleet,
} from './fleet-overview.ts'

import type { FleetVps } from '@/lib/domain/monitoring/fleet-vps.ts'
import type { FleetStat, ServerMetrics } from './fleet-overview.ts'

const GB = 1_000_000_000

function server(name: string, isOnline: boolean): FleetVps {
	return { name, isOnline, project: null }
}

const servers: FleetVps[] = [
	server('alpha', true),
	server('beta', true),
	server('gamma', false),
]

const NULL_TRAFFIC = { inBytes: null, outBytes: null }

const metricsByName: Record<string, ServerMetrics> = {
	alpha: { cpuPercent: 20, memoryPercent: 30, diskPercent: 40 },
	beta: { cpuPercent: 80, memoryPercent: 50, diskPercent: 95 },
	gamma: { cpuPercent: null, memoryPercent: null, diskPercent: null },
}

describe('computeServerHealth', () => {
	it('reports down when the server is offline, ignoring metrics', () => {
		expect(
			computeServerHealth(false, {
				cpuPercent: 5,
				memoryPercent: 5,
				diskPercent: 5,
			}),
		).toBe('down')
	})

	it('escalates to critical past 90% and warning past 75%', () => {
		expect(computeServerHealth(true, metricsByName.beta!)).toBe('critical')
		expect(
			computeServerHealth(true, {
				cpuPercent: 78,
				memoryPercent: 10,
				diskPercent: 10,
			}),
		).toBe('warning')
		expect(computeServerHealth(true, metricsByName.alpha!)).toBe('running')
	})

	it('reports unknown when an online server has no metric at all', () => {
		expect(computeServerHealth(true, metricsByName.gamma!)).toBe('unknown')
	})

	it('stays running when at least one metric is present and healthy', () => {
		expect(
			computeServerHealth(true, {
				cpuPercent: 20,
				memoryPercent: null,
				diskPercent: null,
			}),
		).toBe('running')
	})
})

describe('deriveFleetAlerts', () => {
	it('raises one alert per breached metric on running servers only', () => {
		const alerts = deriveFleetAlerts(servers, metricsByName)
		expect(alerts).toHaveLength(2)

		const diskAlert = alerts.find(a => a.metric === 'disk')
		expect(diskAlert).toMatchObject({
			vpsName: 'beta',
			severity: 'critical',
			thresholdPercent: 90,
			valuePercent: 95,
			label: 'Disque à 95%',
		})

		const cpuAlert = alerts.find(a => a.metric === 'cpu')
		expect(cpuAlert).toMatchObject({
			vpsName: 'beta',
			severity: 'warning',
			thresholdPercent: 75,
			label: 'CPU à 80%',
		})
	})

	it('returns nothing when every metric is below the warning band', () => {
		expect(deriveFleetAlerts([servers[0]!], metricsByName)).toHaveLength(0)
	})
})

describe('summarizeFleet', () => {
	const stats = summarizeFleet({
		servers,
		metricsByName,
		errorCount: 12,
		windowHours: 6,
		cpuWindowAverage: 50,
		cpuNodeCount: 2,
		traffic: { inBytes: 500 * GB, outBytes: 2_000 * GB },
	})
	const byLabel = (label: string): FleetStat | undefined =>
		stats.find(s => s.label === label)

	it('counts online servers out of the fleet', () => {
		expect(byLabel('VPS actifs')).toMatchObject({
			value: '2/3',
			hint: '1 hors ligne',
			tone: 'warning',
		})
	})

	it('renders the windowed CPU average under a range-labelled title', () => {
		expect(byLabel('CPU moyen (6 h)')).toMatchObject({
			value: '50%',
			hint: '2 nœuds',
			tone: 'neutral',
		})
	})

	it('escalates the CPU stat tone once the average breaches a band', () => {
		const hot = summarizeFleet({
			servers,
			metricsByName,
			errorCount: 0,
			windowHours: 1,
			cpuWindowAverage: 92,
			cpuNodeCount: 2,
			traffic: NULL_TRAFFIC,
		})
		expect(hot.find(s => s.label === 'CPU moyen (1 h)')).toMatchObject({
			value: '92%',
			tone: 'danger',
		})
	})

	it('renders the windowed traffic totals under a range-labelled title', () => {
		expect(byLabel('Trafic sortant (6 h)')).toMatchObject({
			value: '2.00 TB',
			hint: '\u2193 500.0 GB entrant',
		})
	})

	it('surfaces the error count and alert total under a range label', () => {
		expect(byLabel('Erreurs (6 h)')).toMatchObject({
			value: '12',
			hint: '2 alertes',
			tone: 'danger',
		})
	})

	it('labels the window honestly for a different range', () => {
		const day = summarizeFleet({
			servers,
			metricsByName,
			errorCount: 0,
			windowHours: 24,
			cpuWindowAverage: 10,
			cpuNodeCount: 2,
			traffic: NULL_TRAFFIC,
		})
		expect(day.some(s => s.label === 'CPU moyen (24 h)')).toBe(true)
		expect(day.some(s => s.label === 'Erreurs (24 h)')).toBe(true)
	})

	it('shows a neutral placeholder when the window has no CPU sample', () => {
		const blind = summarizeFleet({
			servers,
			metricsByName,
			errorCount: 0,
			windowHours: 6,
			cpuWindowAverage: null,
			cpuNodeCount: 0,
			traffic: NULL_TRAFFIC,
		})
		expect(
			blind.find(stat => stat.label === 'CPU moyen (6 h)'),
		).toMatchObject({
			value: '-',
			hint: 'aucune métrique',
			tone: 'neutral',
		})
	})
})

describe('fleetCpuWindowAverage', () => {
	it('averages each server mean, ignoring empty series', () => {
		const { average, nodeCount } = fleetCpuWindowAverage([
			[10, 30], // mean 20
			[], // no samples for the window - contributes nothing
			[60, 80], // mean 70
		])
		expect(nodeCount).toBe(2)
		expect(average).toBe(45)
	})

	it('returns null when no server reported a single sample', () => {
		expect(fleetCpuWindowAverage([[], []])).toEqual({
			average: null,
			nodeCount: 0,
		})
	})
})
