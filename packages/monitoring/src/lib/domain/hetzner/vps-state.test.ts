import { describe, expect, it } from 'vitest'

import { parseVpsState, selectOwnerProject } from './vps-state.ts'

describe('parseVpsState', () => {
	it('extracts the public IP and the sorted project list', () => {
		const slice = parseVpsState({
			phase: 'converged',
			serverId: 42,
			publicIp: '1.2.3.4',
			tailnetIp: '100.64.0.21',
			hostPorts: {
				stylot: { app: 8080 },
				acme: { web: 8081 },
			},
		})
		expect(slice).toEqual({
			publicIp: '1.2.3.4',
			projects: ['acme', 'stylot'],
		})
	})

	it('returns null for a non-record payload', () => {
		expect(parseVpsState('broken')).toBeNull()
	})

	it('tolerates a state without hostPorts or publicIp', () => {
		expect(parseVpsState({})).toEqual({ publicIp: null, projects: [] })
	})
})

describe('selectOwnerProject', () => {
	it('prefers the project named like the VPS', () => {
		const owner = selectOwnerProject(
			{ publicIp: null, projects: ['acme', 'stylot'] },
			'stylot',
		)
		expect(owner).toBe('stylot')
	})

	it('falls back to the first project alphabetically', () => {
		const owner = selectOwnerProject(
			{ publicIp: null, projects: ['acme', 'zulu'] },
			'nn-prod',
		)
		expect(owner).toBe('acme')
	})

	it('yields null when the VPS hosts nothing yet', () => {
		expect(
			selectOwnerProject({ publicIp: null, projects: [] }, 'fresh'),
		).toBeNull()
	})
})
