import { describe, expect, it } from 'vitest'

import { buildSdTargets } from './sd-targets.ts'

import type { TaggedDevice } from '@/lib/domain/tailscale/tagged-device.ts'

const STYLOT_VPS: TaggedDevice = {
	hostname: 'stylot',
	ipv4: '100.64.0.21',
	tags: ['tag:server'],
}

describe('buildSdTargets', () => {
	it('emits one group per exporter port with the relabel meta labels', () => {
		const groups = buildSdTargets({
			devices: [STYLOT_VPS],
			statesByHostname: {
				stylot: { publicIp: '1.2.3.4', projects: ['stylot'] },
			},
			clientId: 'nextnode',
		})

		expect(groups).toEqual([
			{
				targets: ['100.64.0.21:9100'],
				labels: {
					__meta_tailscale_device_tags: 'tag:server',
					__meta_tailscale_device_hostname: 'stylot',
					__meta_nextnode_exporter: 'node',
					__meta_nextnode_client_id: 'nextnode',
					__meta_nextnode_project: 'stylot',
				},
			},
			{
				targets: ['100.64.0.21:9101'],
				labels: {
					__meta_tailscale_device_tags: 'tag:server',
					__meta_tailscale_device_hostname: 'stylot',
					__meta_nextnode_exporter: 'cadvisor',
					__meta_nextnode_client_id: 'nextnode',
					__meta_nextnode_project: 'stylot',
				},
			},
			{
				targets: ['100.64.0.21:9187'],
				labels: {
					__meta_tailscale_device_tags: 'tag:server',
					__meta_tailscale_device_hostname: 'stylot',
					__meta_nextnode_exporter: 'postgres',
					__meta_nextnode_client_id: 'nextnode',
					__meta_nextnode_project: 'stylot',
				},
			},
		])
	})

	it('drops devices that are not NextNode servers (admin laptop / CI runner)', () => {
		const ciRunner: TaggedDevice = {
			hostname: 'ci-runner',
			ipv4: '100.64.0.7',
			tags: ['tag:ci'],
		}
		const groups = buildSdTargets({
			devices: [ciRunner],
			statesByHostname: {},
			clientId: undefined,
		})
		expect(groups).toEqual([])
	})

	it('omits the project and client_id labels when unknown', () => {
		const groups = buildSdTargets({
			devices: [STYLOT_VPS],
			statesByHostname: { stylot: null },
			clientId: undefined,
		})
		expect(groups[0]?.labels).toEqual({
			__meta_tailscale_device_tags: 'tag:server',
			__meta_tailscale_device_hostname: 'stylot',
			__meta_nextnode_exporter: 'node',
		})
	})

	it('labels a shared VPS with its owner project', () => {
		const sharedVps: TaggedDevice = {
			hostname: 'nn-prod',
			ipv4: '100.64.0.30',
			tags: ['tag:server'],
		}
		const groups = buildSdTargets({
			devices: [sharedVps],
			statesByHostname: {
				'nn-prod': {
					publicIp: '5.6.7.8',
					projects: ['acme', 'stylot'],
				},
			},
			clientId: undefined,
		})
		expect(groups[0]?.labels).toMatchObject({
			__meta_nextnode_project: 'acme',
		})
	})
})
