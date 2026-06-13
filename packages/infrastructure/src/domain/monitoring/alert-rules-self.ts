import type { RuleGroup } from './alert-rule.ts'

/** Active-series ceiling before the cardinality alert fires (PRD §8). */
const ACTIVE_SERIES_BUDGET = 100_000

/**
 * The monitoring monitors itself: heartbeat, cardinality budget, and the
 * per-project log-silence detector.
 */
export const SELF_RULE_GROUP: RuleGroup = {
	name: 'self',
	rules: [
		{
			// Always-firing heartbeat. Routed by Alertmanager to the
			// external dead man's switch, never to email: its SILENCE is
			// the alert, delivered by healthchecks.io from outside the
			// tailnet.
			alert: 'Watchdog',
			expr: 'vector(1)',
			labels: { severity: 'none' },
			annotations: {
				summary: 'Monitoring pipeline heartbeat',
				description:
					'Always firing. If healthchecks.io stops receiving this, vmalert, Alertmanager or the whole monitoring VPS is down.',
			},
		},
		{
			alert: 'ActiveSeriesBudgetExceeded',
			expr: `vm_cache_entries{type="storage/hour_metric_ids"} > ${String(ACTIVE_SERIES_BUDGET)}`,
			for: '30m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'VictoriaMetrics active series over budget',
				description:
					'More than 100k active series in VictoriaMetrics - a cardinality leak somewhere (cAdvisor labels are the usual suspect). Inspect via vmui before RAM suffers.',
			},
		},
		{
			// A project whose VPS answers scrapes but whose logs stopped:
			// Vector (or its sink) is broken on that host. The join works
			// on the `project` label - nn:log_lines_15m is recorded by the
			// vlogs vmalert with the nn_project stream field, renamed here.
			alert: 'VectorSilent',
			expr: 'max by (project) (up{job="node"}) == 1 unless on (project) (label_replace(nn:log_lines_15m, "project", "$1", "nn_project", "(.+)") > 0)',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'No logs from project {{ $labels.project }}',
				description:
					'The VPS of {{ $labels.project }} is up (node_exporter answers) but VictoriaLogs received zero log lines from it in 15 minutes - Vector or its sink is broken on that host.',
			},
		},
	],
}

/**
 * Recording rules evaluated against VictoriaLogs (group `type: vlogs`)
 * and remote-written into VictoriaMetrics, where the alert expressions
 * join them with scrape-derived series. Keeping the vlogs side
 * record-only sidesteps the vmalert↔VictoriaLogs alerting-state quirks
 * the PRD flags as a risk: alerts always evaluate in the metrics vmalert.
 *
 * The `http.log.access` filter matches Caddy's access-log logger name -
 * those lines reach VictoriaLogs via journald → Vector once the Caddy
 * config enables per-server logging (P4).
 */
export const VLOGS_RECORDING_RULE_GROUP: RuleGroup = {
	name: 'logs-derived',
	type: 'vlogs',
	interval: '60s',
	rules: [
		{
			record: 'nn:log_lines_15m',
			expr: '_time:15m | stats by (nn_project) count() as value',
		},
		{
			record: 'nn:http_requests_5m',
			expr: '_time:5m nn_project:* "logger":"http.log.access" | unpack_json | stats by (request.host) count() as value',
		},
		{
			record: 'nn:http_5xx_5m',
			expr: '_time:5m nn_project:* "logger":"http.log.access" | unpack_json | filter status:>=500 | stats by (request.host) count() as value',
		},
		{
			record: 'nn:http_duration_p95_5m',
			expr: '_time:5m nn_project:* "logger":"http.log.access" | unpack_json | stats by (request.host) quantile(0.95, duration) as value',
		},
	],
}
