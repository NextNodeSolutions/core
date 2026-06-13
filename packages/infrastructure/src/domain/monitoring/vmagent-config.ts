import { stringify } from 'yaml'

import {
	CLIENT_VPS_EXPORTERS,
	buildClientVpsRelabelRules,
} from './client-vps-relabel.ts'

import type { ClientVpsExporter } from './client-vps-relabel.ts'
import type { RelabelRule } from './client-vps-relabel.ts'

/**
 * Scrape cadence for every job - the freshness contract of the PRD
 * (panne détectée < 5 min relies on 15 s scrapes + `for:` windows).
 */
const SCRAPE_INTERVAL = '15s'

/** How often vmagent re-polls the SD endpoint for fresh targets. */
const SD_REFRESH_INTERVAL = '60s'

/**
 * Well-known exporter ports on a client VPS, mirrored by the SD endpoint
 * when it emits one target per (VPS, exporter).
 */
export const NODE_EXPORTER_PORT = 9100
export const CADVISOR_EXPORTER_PORT = 9101

export interface VmagentSelfTarget {
	/** Tailnet IPv4 of the VPS hosting this stack (cAdvisor binds it). */
	readonly tailnetIp: string
	readonly projectName: string
	readonly environment: string
	readonly clientId: string
	readonly vpsName: string
}

export interface VmagentConfigInput {
	/** http_sd URL emitting client-VPS exporter targets (`/api/sd/targets`). */
	readonly sdTargetsUrl: string
	/** http_sd URL emitting public domains to probe (`/api/sd/probes`). */
	readonly sdProbesUrl: string
	/**
	 * Loopback address + path of the control plane's backup-freshness
	 * exposition (`/api/metrics/backups`), scraped at a slow cadence.
	 */
	readonly backupMetricsAddress: string
	readonly backupMetricsPath: string
	/** Loopback address of blackbox_exporter (vmagent runs host-networked). */
	readonly blackboxAddress: string
	/** Loopback ports of the stack's own components for the self job. */
	readonly selfPorts: ReadonlyArray<number>
	readonly self: VmagentSelfTarget
}

interface ScrapeJob {
	readonly job_name: string
	readonly scrape_interval?: string
	readonly metrics_path?: string
	readonly honor_labels?: boolean
	readonly params?: Readonly<Record<string, ReadonlyArray<string>>>
	readonly http_sd_configs?: ReadonlyArray<{
		readonly url: string
		readonly refresh_interval: string
	}>
	readonly static_configs?: ReadonlyArray<{
		readonly targets: ReadonlyArray<string>
		readonly labels?: Readonly<Record<string, string>>
	}>
	readonly relabel_configs?: ReadonlyArray<RelabelRule>
	readonly metric_relabel_configs?: ReadonlyArray<RelabelRule>
}

/**
 * cAdvisor's per-metric labels are the cardinality risk the PRD flags:
 * `container_label_*` mirrors every docker label, `id` is a cgroup path,
 * `image` repeats the full ref on every series. Keep `name` mapped to the
 * whitelisted `container_name`, drop the rest at scrape time so the
 * budget (< 2 000 séries/VPS) is enforced before storage.
 */
function buildCadvisorMetricRelabel(): ReadonlyArray<RelabelRule> {
	return [
		{
			action: 'replace',
			source_labels: ['name'],
			target_label: 'container_name',
		},
		{
			action: 'labeldrop',
			regex: '^(container_label_.+|id|image|name)$',
		},
	]
}

function buildClientVpsJob(
	exporter: ClientVpsExporter,
	sdTargetsUrl: string,
): ScrapeJob {
	return {
		job_name: exporter,
		http_sd_configs: [
			{ url: sdTargetsUrl, refresh_interval: SD_REFRESH_INTERVAL },
		],
		relabel_configs: buildClientVpsRelabelRules(exporter),
		...(exporter === 'cadvisor' && {
			metric_relabel_configs: buildCadvisorMetricRelabel(),
		}),
	}
}

/**
 * The monitoring VPS is deliberately NOT tagged client-vps (the relabel
 * keep rule would drop it); its own exporters and the stack components
 * are scraped by this static job - the monitoring monitors itself.
 */
function buildSelfJob(input: VmagentConfigInput): ScrapeJob {
	const { self } = input
	const targets = [
		`127.0.0.1:${String(NODE_EXPORTER_PORT)}`,
		`${self.tailnetIp}:${String(CADVISOR_EXPORTER_PORT)}`,
		...input.selfPorts.map(port => `127.0.0.1:${String(port)}`),
	]
	return {
		job_name: 'self',
		static_configs: [
			{
				targets,
				labels: {
					client_id: self.clientId,
					project: self.projectName,
					environment: self.environment,
					vps_name: self.vpsName,
				},
			},
		],
		metric_relabel_configs: buildCadvisorMetricRelabel(),
	}
}

/**
 * Blackbox probes: external-view HTTPS checks of every public domain the
 * SD layer reports. The standard blackbox indirection applies - the SD
 * target (a URL) becomes the `target` query param, `instance` keeps the
 * probed URL, and the actual scraped address is the local blackbox.
 */
function buildBlackboxJob(input: VmagentConfigInput): ScrapeJob {
	return {
		job_name: 'blackbox',
		metrics_path: '/probe',
		params: { module: ['http_2xx'] },
		http_sd_configs: [
			{ url: input.sdProbesUrl, refresh_interval: SD_REFRESH_INTERVAL },
		],
		relabel_configs: [
			{
				action: 'replace',
				source_labels: ['__address__'],
				target_label: '__param_target',
			},
			{
				action: 'replace',
				source_labels: ['__param_target'],
				target_label: 'instance',
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
				// A fixed replacement needs no source; YAML renders the
				// `replacement` key directly.
				replacement: input.blackboxAddress,
				target_label: '__address__',
			},
		],
	}
}

/**
 * Backup freshness: the control plane lists each project's backup bucket
 * and exposes the newest dump timestamp. `honor_labels` keeps the
 * per-project labels the exposition carries; the slow cadence matches a
 * signal that moves once a day.
 */
function buildBackupsJob(input: VmagentConfigInput): ScrapeJob {
	return {
		job_name: 'backups',
		scrape_interval: '5m',
		metrics_path: input.backupMetricsPath,
		honor_labels: true,
		static_configs: [{ targets: [input.backupMetricsAddress] }],
	}
}

/**
 * Render the vmagent scrape configuration: one job per client-VPS
 * exporter (node / cadvisor / postgres, all fed by the same http_sd
 * endpoint and filtered by the relabel pipeline), the self job, and the
 * blackbox probe job. Pure - every deployment-side value arrives as
 * input.
 */
export function renderVmagentConfig(input: VmagentConfigInput): string {
	const config = {
		global: { scrape_interval: SCRAPE_INTERVAL },
		scrape_configs: [
			...CLIENT_VPS_EXPORTERS.map(exporter =>
				buildClientVpsJob(exporter, input.sdTargetsUrl),
			),
			buildSelfJob(input),
			buildBlackboxJob(input),
			buildBackupsJob(input),
		],
	}
	return stringify(config, { lineWidth: 0 })
}
