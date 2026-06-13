import { isRecord } from '#/kernel/guards.ts'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { renderVmagentConfig } from './vmagent-config.ts'

import type { VmagentConfigInput } from './vmagent-config.ts'

const INPUT: VmagentConfigInput = {
	sdTargetsUrl: 'http://127.0.0.1:8080/api/sd/targets',
	sdProbesUrl: 'http://127.0.0.1:8080/api/sd/probes',
	blackboxAddress: '127.0.0.1:9115',
	selfPorts: [8428, 9428, 9115],
	self: {
		tailnetIp: '100.64.0.7',
		projectName: 'monitoring',
		environment: 'production',
		clientId: 'nextnode',
		vpsName: 'nn-internals',
	},
}

function parseJobs(yaml: string): ReadonlyArray<Record<string, unknown>> {
	const parsed: unknown = parse(yaml)
	if (!isRecord(parsed) || !Array.isArray(parsed.scrape_configs)) {
		throw new Error('invalid scrape config shape')
	}
	return parsed.scrape_configs.filter(isRecord)
}

function relabelRulesOf(
	job: Record<string, unknown> | undefined,
): ReadonlyArray<unknown> {
	if (job === undefined || !Array.isArray(job.relabel_configs)) {
		throw new Error('job has no relabel_configs array')
	}
	return job.relabel_configs
}

describe('renderVmagentConfig', () => {
	const yaml = renderVmagentConfig(INPUT)
	const jobs = parseJobs(yaml)

	it('renders five jobs: one per client exporter, self, blackbox', () => {
		expect(jobs.map(job => job.job_name)).toEqual([
			'node',
			'cadvisor',
			'postgres',
			'self',
			'blackbox',
		])
	})

	it('sets the 15s scrape cadence globally', () => {
		const parsed: unknown = parse(yaml)
		expect(parsed).toMatchObject({
			global: { scrape_interval: '15s' },
		})
	})

	it('feeds every client job from the same http_sd endpoint', () => {
		for (const name of ['node', 'cadvisor', 'postgres']) {
			const job = jobs.find(candidate => candidate.job_name === name)
			expect(job?.http_sd_configs).toEqual([
				{
					url: 'http://127.0.0.1:8080/api/sd/targets',
					refresh_interval: '60s',
				},
			])
		}
	})

	it('filters each client job to its own exporter via the SD meta label', () => {
		const node = jobs.find(job => job.job_name === 'node')
		const rules = relabelRulesOf(node)
		expect(rules).toContainEqual({
			action: 'keep',
			source_labels: ['__meta_nextnode_exporter'],
			regex: '^node$',
		})
	})

	it('drops the cAdvisor label explosion at scrape time on the cadvisor and self jobs', () => {
		for (const name of ['cadvisor', 'self']) {
			const job = jobs.find(candidate => candidate.job_name === name)
			expect(job?.metric_relabel_configs).toEqual([
				{
					action: 'replace',
					source_labels: ['name'],
					target_label: 'container_name',
				},
				{
					action: 'labeldrop',
					regex: '^(container_label_.+|id|image|name)$',
				},
			])
		}
	})

	it('scrapes the monitoring VPS itself via the static self job', () => {
		const self = jobs.find(job => job.job_name === 'self')
		expect(self?.static_configs).toEqual([
			{
				targets: [
					'127.0.0.1:9100',
					'100.64.0.7:9101',
					'127.0.0.1:8428',
					'127.0.0.1:9428',
					'127.0.0.1:9115',
				],
				labels: {
					client_id: 'nextnode',
					project: 'monitoring',
					environment: 'production',
					vps_name: 'nn-internals',
				},
			},
		])
	})

	it('wires the blackbox indirection: SD target → probe param, blackbox as scrape address', () => {
		const blackbox = jobs.find(job => job.job_name === 'blackbox')
		expect(blackbox?.metrics_path).toBe('/probe')
		expect(blackbox?.params).toEqual({ module: ['http_2xx'] })
		const rules = relabelRulesOf(blackbox)
		expect(rules).toContainEqual({
			action: 'replace',
			source_labels: ['__address__'],
			target_label: '__param_target',
		})
		expect(rules).toContainEqual({
			action: 'replace',
			replacement: '127.0.0.1:9115',
			target_label: '__address__',
		})
	})
})
