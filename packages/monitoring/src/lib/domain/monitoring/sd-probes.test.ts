import { describe, expect, it } from 'vitest'

import { buildSdProbes } from './sd-probes.ts'

describe('buildSdProbes', () => {
	it('emits one HTTPS target per public domain with project labels', () => {
		const groups = buildSdProbes([
			{
				hostname: 'stylot',
				ownerProject: 'stylot',
				domains: ['stylot.app', 'dev.stylot.app'],
			},
		])

		expect(groups).toEqual([
			{
				targets: ['https://stylot.app'],
				labels: {
					__meta_tailscale_device_hostname: 'stylot',
					__meta_nextnode_project: 'stylot',
				},
			},
			{
				targets: ['https://dev.stylot.app'],
				labels: {
					__meta_tailscale_device_hostname: 'stylot',
					__meta_nextnode_project: 'stylot',
				},
			},
		])
	})

	it('omits the project label when the owner is unknown', () => {
		const groups = buildSdProbes([
			{ hostname: 'fresh', ownerProject: null, domains: ['x.example'] },
		])
		expect(groups[0]?.labels).toEqual({
			__meta_tailscale_device_hostname: 'fresh',
		})
	})

	it('yields nothing for a VPS with no public domains', () => {
		expect(
			buildSdProbes([
				{ hostname: 'internal', ownerProject: 'x', domains: [] },
			]),
		).toEqual([])
	})
})
