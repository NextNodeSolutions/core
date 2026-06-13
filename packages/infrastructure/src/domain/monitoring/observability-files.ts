import {
	ALERTMANAGER_CONFIG_FILENAME,
	BLACKBOX_CONFIG_FILENAME,
	BLACKBOX_HOST_PORT,
	VICTORIALOGS_HOST_PORT,
	VICTORIAMETRICS_HOST_PORT,
	VMAGENT_CONFIG_FILENAME,
	VMALERT_RULES_FILENAME,
	VMALERT_VLOGS_RULES_FILENAME,
} from '#/domain/services/observability.ts'

import { renderAlertmanagerConfig } from './alertmanager-config.ts'
import { renderBlackboxConfig } from './blackbox-config.ts'
import { renderVmagentConfig } from './vmagent-config.ts'
import {
	renderVmalertMetricRulesYaml,
	renderVmalertVlogsRulesYaml,
} from './vmalert-rules.ts'

export interface ObservabilityDeployFilesInput {
	/**
	 * Loopback host port of the app service serving the SD endpoints -
	 * the same port Caddy dials for the vhost.
	 */
	readonly appHostPort: number
	/** Tailnet IPv4 of the VPS (cAdvisor binds it). */
	readonly tailnetIp: string
	readonly projectName: string
	readonly environment: string
	readonly vpsName: string
	/**
	 * NN client id for the self-scrape labels; may be unknown while the
	 * org variable is not set yet (the chicken-and-egg first deploy that
	 * brings VictoriaLogs itself up) - the label is then omitted.
	 */
	readonly clientId: string | undefined
	readonly resendApiKey: string
	readonly healthchecksPingUrl: string | undefined
}

/**
 * Render every observability config file pushed next to compose.yaml at
 * deploy time, keyed by filename. Pure - the adapter writes them over
 * SFTP and the compose services bind-mount them read-only.
 */
export function buildObservabilityDeployFiles(
	input: ObservabilityDeployFilesInput,
): Readonly<Record<string, string>> {
	const sdBaseUrl = `http://127.0.0.1:${String(input.appHostPort)}`
	return {
		[VMAGENT_CONFIG_FILENAME]: renderVmagentConfig({
			sdTargetsUrl: `${sdBaseUrl}/api/sd/targets`,
			sdProbesUrl: `${sdBaseUrl}/api/sd/probes`,
			backupMetricsAddress: `127.0.0.1:${String(input.appHostPort)}`,
			backupMetricsPath: '/api/metrics/backups',
			blackboxAddress: `127.0.0.1:${String(BLACKBOX_HOST_PORT)}`,
			selfPorts: [
				VICTORIAMETRICS_HOST_PORT,
				VICTORIALOGS_HOST_PORT,
				BLACKBOX_HOST_PORT,
			],
			self: {
				tailnetIp: input.tailnetIp,
				projectName: input.projectName,
				environment: input.environment,
				vpsName: input.vpsName,
				clientId: input.clientId ?? '',
			},
		}),
		[VMALERT_RULES_FILENAME]: renderVmalertMetricRulesYaml(),
		[VMALERT_VLOGS_RULES_FILENAME]: renderVmalertVlogsRulesYaml(),
		[ALERTMANAGER_CONFIG_FILENAME]: renderAlertmanagerConfig({
			resendApiKey: input.resendApiKey,
			healthchecksPingUrl: input.healthchecksPingUrl,
		}),
		[BLACKBOX_CONFIG_FILENAME]: renderBlackboxConfig(),
	}
}
