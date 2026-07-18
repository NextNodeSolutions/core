import { describe, expect, it } from 'vitest'

import { parseFleetVps } from './fleet-vps.ts'

import type { InstantSample } from '@/lib/domain/monitoring/promql-response.ts'

const sample = (
	labels: Record<string, string>,
	upValue: number,
): InstantSample => ({ labels, value: upValue })

describe('parseFleetVps', () => {
	it('maps one sample per VPS with its project and presence', () => {
		const fleet = parseFleetVps([
			sample({ vps_name: 'nn-prod', project: 'stylot' }, 1),
			sample({ vps_name: 'fleurs-prod', project: 'fleurs-v2' }, 1),
		])
		expect(fleet).toEqual([
			{ name: 'fleurs-prod', isOnline: true, project: 'fleurs-v2' },
			{ name: 'nn-prod', isOnline: true, project: 'stylot' },
		])
	})

	it('marks a failing scrape offline and a missing project null', () => {
		const fleet = parseFleetVps([sample({ vps_name: 'nn-edge' }, 0)])
		expect(fleet).toEqual([
			{ name: 'nn-edge', isOnline: false, project: null },
		])
	})

	it('drops samples without a vps_name label', () => {
		expect(parseFleetVps([sample({ project: 'stylot' }, 1)])).toEqual([])
	})

	it('dedupes label churn, letting the online sample win', () => {
		const fleet = parseFleetVps([
			sample({ vps_name: 'nn-prod', project: 'old-project' }, 0),
			sample({ vps_name: 'nn-prod', project: 'stylot' }, 1),
		])
		expect(fleet).toEqual([
			{ name: 'nn-prod', isOnline: true, project: 'stylot' },
		])
	})

	it('sorts the fleet by name for stable rendering', () => {
		const fleet = parseFleetVps([
			sample({ vps_name: 'zulu' }, 1),
			sample({ vps_name: 'alpha' }, 1),
		])
		expect(fleet.map(vps => vps.name)).toEqual(['alpha', 'zulu'])
	})
})
