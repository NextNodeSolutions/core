import type { ObservabilityServiceConfig } from '#/config/types.ts'

/**
 * Pinned images for the observability backend. One editor (VictoriaMetrics)
 * for storage + scrape + alerting evaluation, plus the two Prometheus
 * community pieces (Alertmanager, blackbox_exporter) it routes through.
 * Bumping a constant rolls the new version out to every project declaring
 * `[services.observability]` on the next pipeline run.
 */
export const VICTORIALOGS_IMAGE = 'victoriametrics/victoria-logs:v1.17.0'
export const VICTORIAMETRICS_IMAGE = 'victoriametrics/victoria-metrics:v1.115.0'
export const VMAGENT_IMAGE = 'victoriametrics/vmagent:v1.115.0'
export const VMALERT_IMAGE = 'victoriametrics/vmalert:v1.115.0'
export const ALERTMANAGER_IMAGE = 'prom/alertmanager:v0.28.1'
export const BLACKBOX_EXPORTER_IMAGE = 'prom/blackbox-exporter:v0.25.0'

/** Compose service names for the observability stack. */
export const VICTORIALOGS_SERVICE_NAME = 'victorialogs'
export const VICTORIAMETRICS_SERVICE_NAME = 'victoriametrics'
export const VMAGENT_SERVICE_NAME = 'vmagent'
export const VMALERT_SERVICE_NAME = 'vmalert'
export const VMALERT_VLOGS_SERVICE_NAME = 'vmalert-vlogs'
export const ALERTMANAGER_SERVICE_NAME = 'alertmanager'
export const BLACKBOX_SERVICE_NAME = 'blackbox'

/** Named volumes backing the persistent pieces. */
export const VICTORIALOGS_DATA_VOLUME = 'vl-data'
export const VICTORIAMETRICS_DATA_VOLUME = 'vm-data'
export const VMAGENT_BUFFER_VOLUME = 'vmagent-data'
export const ALERTMANAGER_DATA_VOLUME = 'am-data'

/**
 * Well-known container ports of each component (upstream defaults).
 */
export const VICTORIALOGS_PORT = 9428
export const VICTORIAMETRICS_PORT = 8428
export const ALERTMANAGER_PORT = 9093
export const BLACKBOX_PORT = 9115

/**
 * Host-side loopback ports the stack publishes. VictoriaLogs and
 * VictoriaMetrics sit behind Caddy vhosts (logs./metrics.), so they bind
 * 127.0.0.1 at their upstream port - deliberately OUTSIDE the app host
 * port range [8080, 8200) so no allocation is needed and the dial targets
 * are deterministic. blackbox is published on loopback so vmagent (which
 * runs with host networking - see buildVmagentService) can scrape and
 * drive it. Nothing observability-related ever binds the public IP.
 */
export const VICTORIALOGS_HOST_PORT = VICTORIALOGS_PORT
export const VICTORIAMETRICS_HOST_PORT = VICTORIAMETRICS_PORT
export const BLACKBOX_HOST_PORT = BLACKBOX_PORT

/**
 * Config files rendered in TS at deploy time and pushed by SFTP next to
 * `compose.yaml` (same mechanism as the postgres-exporter SQL/queries
 * files). The compose services bind-mount them read-only.
 */
export const VMAGENT_CONFIG_FILENAME = 'vmagent.yml'
export const VMALERT_RULES_FILENAME = 'vmalert-rules.yml'
export const VMALERT_VLOGS_RULES_FILENAME = 'vmalert-vlogs-rules.yml'
export const ALERTMANAGER_CONFIG_FILENAME = 'alertmanager.yml'
export const BLACKBOX_CONFIG_FILENAME = 'blackbox.yml'

const VMAGENT_CONFIG_MOUNT = '/etc/vmagent/scrape.yml'
const VMALERT_RULES_MOUNT = '/etc/vmalert/rules.yml'
const ALERTMANAGER_CONFIG_MOUNT = '/etc/alertmanager/alertmanager.yml'
const BLACKBOX_CONFIG_MOUNT = '/etc/blackbox_exporter/config.yml'

/**
 * In-compose URLs the evaluation pieces use to reach storage + routing.
 * vmalert and alertmanager stay on the compose network (they only talk to
 * siblings); vmagent is the one host-networked exception.
 */
const VICTORIAMETRICS_INTERNAL_URL = `http://${VICTORIAMETRICS_SERVICE_NAME}:${String(VICTORIAMETRICS_PORT)}`
const VICTORIALOGS_INTERNAL_URL = `http://${VICTORIALOGS_SERVICE_NAME}:${String(VICTORIALOGS_PORT)}`
const ALERTMANAGER_INTERNAL_URL = `http://${ALERTMANAGER_SERVICE_NAME}:${String(ALERTMANAGER_PORT)}`

/**
 * Loopback URLs vmagent (host networking) uses: VictoriaMetrics for
 * remote_write, the app's SD endpoint, blackbox. Exported for the vmagent
 * config renderer.
 */
export const VICTORIAMETRICS_LOOPBACK_URL = `http://127.0.0.1:${String(VICTORIAMETRICS_HOST_PORT)}`

/**
 * Memory ceilings per component, sized for a cx33 (8 GB) shared with the
 * Astro app. Bound an emballement (cardinality spike, log flood) before
 * it can take the VPS down - the component OOMs and restarts instead.
 */
const MEM_LIMITS = {
	victorialogs: '1g',
	victoriametrics: '1536m',
	vmagent: '512m',
	vmalert: '256m',
	alertmanager: '256m',
	blackbox: '128m',
} as const

export interface ObservabilityComposeService {
	readonly image: string
	readonly restart: string
	readonly command?: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
	readonly ports?: ReadonlyArray<string>
	readonly depends_on?: ReadonlyArray<string>
	readonly network_mode?: string
	readonly mem_limit?: string
}

export type ObservabilityStack = Readonly<
	Record<string, ObservabilityComposeService>
>

function buildVictoriaLogsService(
	config: ObservabilityServiceConfig,
): ObservabilityComposeService {
	return {
		image: VICTORIALOGS_IMAGE,
		restart: 'unless-stopped',
		command: [
			`-retentionPeriod=${config.logsRetention}`,
			'-storageDataPath=/victoria-logs-data',
		],
		volumes: [`${VICTORIALOGS_DATA_VOLUME}:/victoria-logs-data`],
		ports: [
			`127.0.0.1:${String(VICTORIALOGS_HOST_PORT)}:${String(VICTORIALOGS_PORT)}`,
		],
		mem_limit: MEM_LIMITS.victorialogs,
	}
}

function buildVictoriaMetricsService(
	config: ObservabilityServiceConfig,
): ObservabilityComposeService {
	return {
		image: VICTORIAMETRICS_IMAGE,
		restart: 'unless-stopped',
		command: [
			// VictoriaMetrics' -retentionPeriod bare-number unit is months.
			`-retentionPeriod=${String(config.metricsRetentionMonths)}`,
			'-storageDataPath=/victoria-metrics-data',
		],
		volumes: [`${VICTORIAMETRICS_DATA_VOLUME}:/victoria-metrics-data`],
		ports: [
			`127.0.0.1:${String(VICTORIAMETRICS_HOST_PORT)}:${String(VICTORIAMETRICS_PORT)}`,
		],
		mem_limit: MEM_LIMITS.victoriametrics,
	}
}

/**
 * vmagent runs with HOST networking - the single deliberate exception in
 * the stack. Reasons, all scrape-path: (a) client-VPS exporters are
 * reached over the tailnet, natively routed via the host's tailscale0;
 * (b) the VPS's own node_exporter/cAdvisor sit behind UFW rules that
 * allow tailscale0 but not docker0, so a bridged container cannot scrape
 * its own host; (c) the SD endpoint is the app's loopback host port -
 * the same one Caddy dials. Host networking exposes nothing new: vmagent
 * only listens on loopback (its own :8429 stays unbound from the public
 * IP via -httpListenAddr).
 */
function buildVmagentService(): ObservabilityComposeService {
	return {
		image: VMAGENT_IMAGE,
		restart: 'unless-stopped',
		network_mode: 'host',
		command: [
			`-promscrape.config=${VMAGENT_CONFIG_MOUNT}`,
			`-remoteWrite.url=${VICTORIAMETRICS_LOOPBACK_URL}/api/v1/write`,
			'-remoteWrite.tmpDataPath=/vmagent-remotewrite-data',
			'-httpListenAddr=127.0.0.1:8429',
		],
		volumes: [
			`./${VMAGENT_CONFIG_FILENAME}:${VMAGENT_CONFIG_MOUNT}:ro`,
			`${VMAGENT_BUFFER_VOLUME}:/vmagent-remotewrite-data`,
		],
		depends_on: [VICTORIAMETRICS_SERVICE_NAME],
		mem_limit: MEM_LIMITS.vmagent,
	}
}

/**
 * Two vmalert instances because vmalert binds ONE datasource per process:
 * the metrics instance evaluates PromQL against VictoriaMetrics, the
 * vlogs instance evaluates LogsQL groups against VictoriaLogs. Both
 * notify the same Alertmanager; the vlogs instance also remote-writes its
 * recording rules into VictoriaMetrics so log-derived series (e.g.
 * per-project line counts) are joinable with scrape-derived ones.
 */
function buildVmalertService(): ObservabilityComposeService {
	return {
		image: VMALERT_IMAGE,
		restart: 'unless-stopped',
		command: [
			`-datasource.url=${VICTORIAMETRICS_INTERNAL_URL}`,
			`-notifier.url=${ALERTMANAGER_INTERNAL_URL}`,
			`-remoteWrite.url=${VICTORIAMETRICS_INTERNAL_URL}`,
			`-remoteRead.url=${VICTORIAMETRICS_INTERNAL_URL}`,
			`-rule=${VMALERT_RULES_MOUNT}`,
			'-evaluationInterval=30s',
		],
		volumes: [`./${VMALERT_RULES_FILENAME}:${VMALERT_RULES_MOUNT}:ro`],
		depends_on: [VICTORIAMETRICS_SERVICE_NAME, ALERTMANAGER_SERVICE_NAME],
		mem_limit: MEM_LIMITS.vmalert,
	}
}

function buildVmalertVlogsService(): ObservabilityComposeService {
	return {
		image: VMALERT_IMAGE,
		restart: 'unless-stopped',
		command: [
			`-datasource.url=${VICTORIALOGS_INTERNAL_URL}`,
			`-notifier.url=${ALERTMANAGER_INTERNAL_URL}`,
			`-remoteWrite.url=${VICTORIAMETRICS_INTERNAL_URL}`,
			`-rule=${VMALERT_RULES_MOUNT}`,
			'-evaluationInterval=30s',
		],
		volumes: [
			`./${VMALERT_VLOGS_RULES_FILENAME}:${VMALERT_RULES_MOUNT}:ro`,
		],
		depends_on: [
			VICTORIALOGS_SERVICE_NAME,
			VICTORIAMETRICS_SERVICE_NAME,
			ALERTMANAGER_SERVICE_NAME,
		],
		mem_limit: MEM_LIMITS.vmalert,
	}
}

function buildAlertmanagerService(): ObservabilityComposeService {
	return {
		image: ALERTMANAGER_IMAGE,
		restart: 'unless-stopped',
		command: [
			`--config.file=${ALERTMANAGER_CONFIG_MOUNT}`,
			'--storage.path=/alertmanager',
		],
		volumes: [
			`./${ALERTMANAGER_CONFIG_FILENAME}:${ALERTMANAGER_CONFIG_MOUNT}:ro`,
			`${ALERTMANAGER_DATA_VOLUME}:/alertmanager`,
		],
		mem_limit: MEM_LIMITS.alertmanager,
	}
}

function buildBlackboxService(): ObservabilityComposeService {
	return {
		image: BLACKBOX_EXPORTER_IMAGE,
		restart: 'unless-stopped',
		command: [`--config.file=${BLACKBOX_CONFIG_MOUNT}`],
		volumes: [`./${BLACKBOX_CONFIG_FILENAME}:${BLACKBOX_CONFIG_MOUNT}:ro`],
		ports: [
			`127.0.0.1:${String(BLACKBOX_HOST_PORT)}:${String(BLACKBOX_PORT)}`,
		],
		mem_limit: MEM_LIMITS.blackbox,
	}
}

/**
 * Build the full observability compose stack injected when a project
 * declares `[services.observability]`. Pure: no IO, no env reads. The
 * matching config files (vmagent scrape config, rule files, alertmanager
 * routing, blackbox modules) are rendered by `domain/monitoring/*` and
 * written next to compose.yaml by stageRollout.
 */
export function buildObservabilityStack(
	config: ObservabilityServiceConfig,
): ObservabilityStack {
	return {
		[VICTORIALOGS_SERVICE_NAME]: buildVictoriaLogsService(config),
		[VICTORIAMETRICS_SERVICE_NAME]: buildVictoriaMetricsService(config),
		[VMAGENT_SERVICE_NAME]: buildVmagentService(),
		[VMALERT_SERVICE_NAME]: buildVmalertService(),
		[VMALERT_VLOGS_SERVICE_NAME]: buildVmalertVlogsService(),
		[ALERTMANAGER_SERVICE_NAME]: buildAlertmanagerService(),
		[BLACKBOX_SERVICE_NAME]: buildBlackboxService(),
	}
}

/** Named volumes the observability stack adds to the compose file. */
export const OBSERVABILITY_VOLUMES = [
	VICTORIALOGS_DATA_VOLUME,
	VICTORIAMETRICS_DATA_VOLUME,
	VMAGENT_BUFFER_VOLUME,
	ALERTMANAGER_DATA_VOLUME,
] as const
