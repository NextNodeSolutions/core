import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	CLIENT_VPS_LABEL_WHITELIST,
	CLIENT_VPS_TAG,
	buildClientVpsRelabelRules,
	renderClientVpsRelabelYaml,
} from './client-vps-relabel.ts'

describe('CLIENT_VPS_TAG', () => {
	it('is the Tailscale tag the monitoring scrape job filters on', () => {
		expect(CLIENT_VPS_TAG).toBe('client-vps')
	})
})

describe('CLIENT_VPS_LABEL_WHITELIST', () => {
	it('lists exactly the labels VictoriaMetrics keeps on client-VPS series', () => {
		expect(CLIENT_VPS_LABEL_WHITELIST).toEqual([
			'client_id',
			'project',
			'environment',
			'vps_name',
			'container_name',
			'region',
			'db_role',
		])
	})
})

describe('buildClientVpsRelabelRules', () => {
	it('opens with a keep rule scoped to the client-vps Tailscale tag', () => {
		const [first] = buildClientVpsRelabelRules()

		expect(first).toEqual({
			action: 'keep',
			source_labels: ['__meta_tailscale_device_tags'],
			regex: '^(.+,)?tag:client-vps(,.+)?$',
		})
	})

	it('keep regex accepts the client-vps tag whether it stands alone or shares the comma-joined list', () => {
		const [first] = buildClientVpsRelabelRules()
		const regex = new RegExp(first?.regex ?? '')

		expect(regex.test('tag:client-vps')).toBe(true)
		expect(regex.test('tag:nextnode-prod,tag:client-vps')).toBe(true)
		expect(regex.test('tag:client-vps,tag:monitoring')).toBe(true)
		expect(regex.test('tag:monitoring')).toBe(false)
		expect(regex.test('')).toBe(false)
	})

	it('emits one replace rule per whitelist label that has an SD source, in whitelist order', () => {
		const replaceRules = buildClientVpsRelabelRules().filter(
			r => r.action === 'replace',
		)

		expect(replaceRules).toEqual([
			{
				action: 'replace',
				source_labels: ['__meta_nextnode_client_id'],
				target_label: 'client_id',
			},
			{
				action: 'replace',
				source_labels: ['__meta_nextnode_project'],
				target_label: 'project',
			},
			{
				action: 'replace',
				source_labels: ['__meta_nextnode_environment'],
				target_label: 'environment',
			},
			{
				action: 'replace',
				source_labels: ['__meta_tailscale_device_hostname'],
				target_label: 'vps_name',
			},
			{
				action: 'replace',
				source_labels: ['__meta_nextnode_container_name'],
				target_label: 'container_name',
			},
			{
				action: 'replace',
				source_labels: ['__meta_tailscale_device_location'],
				target_label: 'region',
			},
		])
	})

	it('does not emit a replace rule for db_role - source is reserved pending P6-08 revival', () => {
		const targets = buildClientVpsRelabelRules()
			.filter(r => r.action === 'replace')
			.map(r => r.target_label)

		expect(targets).not.toContain('db_role')
	})

	it('closes with a labelkeep rule pinned to the whitelist plus __name__', () => {
		const rules = buildClientVpsRelabelRules()
		const last = rules.at(-1)

		expect(last).toEqual({
			action: 'labelkeep',
			regex: '^(__name__|client_id|project|environment|vps_name|container_name|region|db_role)$',
		})
	})

	it('labelkeep regex accepts every whitelist label plus __name__ and rejects anything else', () => {
		const last = buildClientVpsRelabelRules().at(-1)
		const regex = new RegExp(last?.regex ?? '')

		for (const label of CLIENT_VPS_LABEL_WHITELIST) {
			expect(regex.test(label)).toBe(true)
		}
		expect(regex.test('__name__')).toBe(true)

		// Anything outside the whitelist - including SD meta labels,
		// exporter-emitted noise, and prefix-matching look-alikes - is dropped.
		expect(regex.test('__meta_tailscale_device_tags')).toBe(false)
		expect(regex.test('instance')).toBe(false)
		expect(regex.test('job')).toBe(false)
		expect(regex.test('pod')).toBe(false)
		expect(regex.test('client_id_v2')).toBe(false)
		expect(regex.test('client_id_extra')).toBe(false)
	})

	it('orders the pipeline as keep → replace × N → labelkeep so the whitelist is the last word', () => {
		const actions = buildClientVpsRelabelRules().map(r => r.action)

		expect(actions[0]).toBe('keep')
		expect(actions.at(-1)).toBe('labelkeep')
		expect(actions.slice(1, -1).every(a => a === 'replace')).toBe(true)
	})
})

describe('renderClientVpsRelabelYaml', () => {
	it('serialises the rule list under the relabel_configs key VictoriaMetrics scrape jobs expect', () => {
		const yaml = renderClientVpsRelabelYaml()
		const parsed: unknown = parse(yaml)

		expect(parsed).toEqual({
			relabel_configs: buildClientVpsRelabelRules(),
		})
	})

	it('produces valid YAML that round-trips without information loss', () => {
		const yaml = renderClientVpsRelabelYaml()

		expect(() => parse(yaml)).not.toThrow()
		expect(parse(yaml)).toEqual(parse(renderClientVpsRelabelYaml()))
	})
})
