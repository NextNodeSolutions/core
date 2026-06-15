import { describe, expect, it } from 'vitest'

import {
	computeServerHealth,
	deriveFleetAlerts,
	summarizeFleet,
} from './fleet-overview.ts'

import type { HetznerVps, VpsStatus } from '@/lib/domain/hetzner/vps.ts'
import type { FleetStat, ServerMetrics } from './fleet-overview.ts'

const GB = 1_000_000_000

function server(
	name: string,
	status: VpsStatus,
	outgoingGb: number,
	includedGb: number,
): HetznerVps {
	return {
		id: 1,
		name,
		status,
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
			datacenter: 'fsn1-dc14',
		},
		image: 'debian-12',
		createdAt: '2026-01-01T00:00:00Z',
		labels: {},
		traffic: {
			ingoingBytes: 0,
			outgoingBytes: outgoingGb * GB,
			includedBytes: includedGb * GB,
		},
		protection: { delete: false, rebuild: false },
		backupsEnabled: false,
		locked: false,
		volumeCount: 0,
	}
}

const servers: HetznerVps[] = [
	server('alpha', 'running', 500, 20_000),
	server('beta', 'running', 1_500, 20_000),
	server('gamma', 'off', 0, 20_000),
]

const metricsByName: Record<string, ServerMetrics> = {
	alpha: { cpuPercent: 20, memoryPercent: 30, diskPercent: 40 },
	beta: { cpuPercent: 80, memoryPercent: 50, diskPercent: 95 },
	gamma: { cpuPercent: null, memoryPercent: null, diskPercent: null },
}

describe('computeServerHealth', () => {
	it('reports down when the server is not running, ignoring metrics', () => {
		expect(
			computeServerHealth('off', {
				cpuPercent: 5,
				memoryPercent: 5,
				diskPercent: 5,
			}),
		).toBe('down')
	})

	it('escalates to critical past 90% and warning past 75%', () => {
		expect(computeServerHealth('running', metricsByName.beta!)).toBe(
			'critical',
		)
		expect(
			computeServerHealth('running', {
				cpuPercent: 78,
				memoryPercent: 10,
				diskPercent: 10,
			}),
		).toBe('warning')
		expect(computeServerHealth('running', metricsByName.alpha!)).toBe(
			'running',
		)
	})

	it('reports unknown when a running server has no metric at all', () => {
		expect(computeServerHealth('running', metricsByName.gamma!)).toBe(
			'unknown',
		)
	})

	it('stays running when at least one metric is present and healthy', () => {
		expect(
			computeServerHealth('running', {
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
	const stats = summarizeFleet({ servers, metricsByName, errorCount: 12 })
	const byLabel = (label: string): FleetStat | undefined =>
		stats.find(s => s.label === label)

	it('counts running servers out of the fleet', () => {
		expect(byLabel('VPS actifs')).toMatchObject({
			value: '2/3',
			hint: '1 hors service',
			tone: 'warning',
		})
	})

	it('averages CPU only over servers that report metrics', () => {
		expect(byLabel('CPU moyen fleet')).toMatchObject({
			value: '50%',
			hint: '2 nœuds',
			tone: 'neutral',
		})
	})

	it('sums outgoing traffic against the included allowance', () => {
		expect(byLabel('Trafic sortant (mois)')).toMatchObject({
			value: '2.00 TB',
			hint: 'sur 60.00 TB inclus',
		})
	})

	it('surfaces the error count and derived alert total', () => {
		expect(byLabel('Erreurs (6 h)')).toMatchObject({
			value: '12',
			hint: '2 alertes',
			tone: 'danger',
		})
	})

	it('shows a neutral placeholder when no server reports any CPU metric', () => {
		const blind = summarizeFleet({
			servers,
			metricsByName: {
				alpha: {
					cpuPercent: null,
					memoryPercent: null,
					diskPercent: null,
				},
				beta: {
					cpuPercent: null,
					memoryPercent: null,
					diskPercent: null,
				},
				gamma: {
					cpuPercent: null,
					memoryPercent: null,
					diskPercent: null,
				},
			},
			errorCount: 0,
		})
		expect(
			blind.find(stat => stat.label === 'CPU moyen fleet'),
		).toMatchObject({
			value: '-',
			hint: 'aucune métrique',
			tone: 'neutral',
		})
	})
})
