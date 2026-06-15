import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	CLIENT_VPS_LABEL_WHITELIST,
	SCRAPE_TARGET_TAG,
	buildClientVpsRelabelRules,
	renderClientVpsRelabelYaml,
} from './client-vps-relabel.ts'

describe('SCRAPE_TARGET_TAG', () => {
	it('is the Tailscale tag (tag:server) the monitoring scrape job filters on', () => {
		expect(SCRAPE_TARGET_TAG).toBe('server')
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
	it('opens with a keep rule scoped to the tag:server Tailscale tag', () => {
		const [first] = buildClientVpsRelabelRules()

		expect(first).toEqual({
			action: 'keep',
			source_labels: ['__meta_tailscale_device_tags'],
			regex: '^(.+,)?tag:server(,.+)?$',
		})
	})

	it('keep regex accepts tag:server whether it stands alone or shares the comma-joined list', () => {
		const [first] = buildClientVpsRelabelRules()
		const regex = new RegExp(first?.regex ?? '')

		expect(regex.test('tag:server')).toBe(true)
		expect(regex.test('tag:ci,tag:server')).toBe(true)
		expect(regex.test('tag:server,tag:client')).toBe(true)
		expect(regex.test('tag:ci')).toBe(false)
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
				source_labels: ['__meta_tailscale_device_hostname'],
				target_label: 'vps_name',
			},
		])
	})

	it('does not emit a replace rule for the unsourced whitelist slots (environment, container_name, region, db_role)', () => {
		const targets = buildClientVpsRelabelRules()
			.filter(r => r.action === 'replace')
			.map(r => r.target_label)

		expect(targets).not.toContain('environment')
		expect(targets).not.toContain('container_name')
		expect(targets).not.toContain('region')
		expect(targets).not.toContain('db_role')
	})

	it('closes with a labelkeep rule pinned to the whitelist plus the scrape-machinery labels', () => {
		const rules = buildClientVpsRelabelRules()
		const last = rules.at(-1)

		expect(last).toEqual({
			action: 'labelkeep',
			regex: '^(__.*|job|instance|client_id|project|environment|vps_name|container_name|region|db_role)$',
		})
	})

	it('labelkeep regex keeps the whitelist, __-internal labels and the job/instance identity pair, rejects anything else', () => {
		const last = buildClientVpsRelabelRules().at(-1)
		const regex = new RegExp(last?.regex ?? '')

		for (const label of CLIENT_VPS_LABEL_WHITELIST) {
			expect(regex.test(label)).toBe(true)
		}
		expect(regex.test('__name__')).toBe(true)
		// __address__ is consumed to ISSUE the scrape - dropping it here
		// would silently kill every scrape (the bug this regex fixes).
		expect(regex.test('__address__')).toBe(true)
		expect(regex.test('__scheme__')).toBe(true)
		// __meta_* labels survive the relabel stage and are auto-dropped
		// by the scraper afterwards - keeping them here is harmless and
		// required (they share the __ prefix with __address__).
		expect(regex.test('__meta_tailscale_device_tags')).toBe(true)
		// The identity pair every alert expression keys on.
		expect(regex.test('job')).toBe(true)
		expect(regex.test('instance')).toBe(true)

		// Anything else - exporter-emitted noise, prefix look-alikes - drops.
		expect(regex.test('pod')).toBe(false)
		expect(regex.test('client_id_v2')).toBe(false)
		expect(regex.test('client_id_extra')).toBe(false)
		expect(regex.test('container_label_com_docker_compose')).toBe(false)
	})

	it('orders the pipeline as keep → replace × N → labelkeep so the whitelist is the last word', () => {
		const actions = buildClientVpsRelabelRules().map(r => r.action)

		expect(actions[0]).toBe('keep')
		expect(actions.at(-1)).toBe('labelkeep')
		expect(actions.slice(1, -1).every(a => a === 'replace')).toBe(true)
	})

	it('inserts a keep rule on the exporter meta label when a job names its exporter', () => {
		const rules = buildClientVpsRelabelRules('cadvisor')
		const [first, second] = rules

		expect(first?.action).toBe('keep')
		expect(second).toEqual({
			action: 'keep',
			source_labels: ['__meta_nextnode_exporter'],
			regex: '^cadvisor$',
		})
	})

	it('emits no exporter keep rule when no exporter is named', () => {
		const keepRules = buildClientVpsRelabelRules().filter(
			r => r.action === 'keep',
		)

		expect(keepRules).toHaveLength(1)
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
