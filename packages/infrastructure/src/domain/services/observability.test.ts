import { describe, expect, it } from 'vitest'

import {
	ALERTMANAGER_SERVICE_NAME,
	BLACKBOX_SERVICE_NAME,
	OBSERVABILITY_VOLUMES,
	VICTORIALOGS_SERVICE_NAME,
	VICTORIAMETRICS_SERVICE_NAME,
	VMAGENT_SERVICE_NAME,
	VMALERT_SERVICE_NAME,
	VMALERT_VLOGS_SERVICE_NAME,
	buildObservabilityStack,
} from './observability.ts'

import type { ObservabilityServiceConfig } from '#/config/service-config.ts'

const CONFIG: ObservabilityServiceConfig = {
	logsRetention: '30d',
	metricsRetentionMonths: 12,
	logsVhost: 'logs.monitoring.nextnode.fr',
	metricsVhost: 'metrics.monitoring.nextnode.fr',
}

describe('buildObservabilityStack', () => {
	const stack = buildObservabilityStack(CONFIG)

	it('builds the seven components of the stack', () => {
		expect(
			Object.keys(stack).toSorted((a, b) => a.localeCompare(b)),
		).toEqual(
			[
				VICTORIALOGS_SERVICE_NAME,
				VICTORIAMETRICS_SERVICE_NAME,
				VMAGENT_SERVICE_NAME,
				VMALERT_SERVICE_NAME,
				VMALERT_VLOGS_SERVICE_NAME,
				ALERTMANAGER_SERVICE_NAME,
				BLACKBOX_SERVICE_NAME,
			].toSorted((a, b) => a.localeCompare(b)),
		)
	})

	it('passes the retentions through to the Victoria* command flags', () => {
		expect(stack[VICTORIALOGS_SERVICE_NAME]?.command).toContain(
			'-retentionPeriod=30d',
		)
		expect(stack[VICTORIAMETRICS_SERVICE_NAME]?.command).toContain(
			'-retentionPeriod=12',
		)
	})

	it('publishes VictoriaLogs and VictoriaMetrics on loopback only', () => {
		expect(stack[VICTORIALOGS_SERVICE_NAME]?.ports).toEqual([
			'127.0.0.1:9428:9428',
		])
		expect(stack[VICTORIAMETRICS_SERVICE_NAME]?.ports).toEqual([
			'127.0.0.1:8428:8428',
		])
		expect(stack[BLACKBOX_SERVICE_NAME]?.ports).toEqual([
			'127.0.0.1:9115:9115',
		])
	})

	it('never binds a public interface - every published port is 127.0.0.1', () => {
		for (const service of Object.values(stack)) {
			for (const port of service.ports ?? []) {
				expect(port.startsWith('127.0.0.1:')).toBe(true)
			}
		}
	})

	it('runs vmagent host-networked and keeps every other component on the compose network', () => {
		expect(stack[VMAGENT_SERVICE_NAME]?.network_mode).toBe('host')
		for (const [name, service] of Object.entries(stack)) {
			if (name === VMAGENT_SERVICE_NAME) continue
			expect(service.network_mode).toBeUndefined()
		}
	})

	it('binds vmagent http endpoint to loopback so host networking exposes nothing', () => {
		expect(stack[VMAGENT_SERVICE_NAME]?.command).toContain(
			'-httpListenAddr=127.0.0.1:8429',
		)
	})

	it('points the metrics vmalert at VictoriaMetrics and the vlogs vmalert at VictoriaLogs', () => {
		expect(stack[VMALERT_SERVICE_NAME]?.command).toContain(
			'-datasource.url=http://victoriametrics:8428',
		)
		expect(stack[VMALERT_VLOGS_SERVICE_NAME]?.command).toContain(
			'-datasource.url=http://victorialogs:9428',
		)
		// The vlogs instance remote-writes its recording rules into VM so
		// log-derived series are joinable with scrape-derived ones.
		expect(stack[VMALERT_VLOGS_SERVICE_NAME]?.command).toContain(
			'-remoteWrite.url=http://victoriametrics:8428',
		)
	})

	it('persists data on the four named volumes', () => {
		expect(OBSERVABILITY_VOLUMES).toEqual([
			'vl-data',
			'vm-data',
			'vmagent-data',
			'am-data',
		])
		expect(stack[VICTORIALOGS_SERVICE_NAME]?.volumes).toContain(
			'vl-data:/victoria-logs-data',
		)
		expect(stack[VICTORIAMETRICS_SERVICE_NAME]?.volumes).toContain(
			'vm-data:/victoria-metrics-data',
		)
		expect(stack[ALERTMANAGER_SERVICE_NAME]?.volumes).toContain(
			'am-data:/alertmanager',
		)
	})

	it('caps memory on every component so a runaway cannot take the VPS down', () => {
		for (const service of Object.values(stack)) {
			expect(service.mem_limit).toBeDefined()
		}
	})

	it('bind-mounts the rendered config files read-only from the compose directory', () => {
		expect(stack[VMAGENT_SERVICE_NAME]?.volumes).toContain(
			'./vmagent.yml:/etc/vmagent/scrape.yml:ro',
		)
		expect(stack[VMALERT_SERVICE_NAME]?.volumes).toContain(
			'./vmalert-rules.yml:/etc/vmalert/rules.yml:ro',
		)
		expect(stack[VMALERT_VLOGS_SERVICE_NAME]?.volumes).toContain(
			'./vmalert-vlogs-rules.yml:/etc/vmalert/rules.yml:ro',
		)
		expect(stack[ALERTMANAGER_SERVICE_NAME]?.volumes).toContain(
			'./alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro',
		)
		expect(stack[BLACKBOX_SERVICE_NAME]?.volumes).toContain(
			'./blackbox.yml:/etc/blackbox_exporter/config.yml:ro',
		)
	})
})
