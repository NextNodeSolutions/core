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
			// A VPS that answers scrapes but stopped shipping logs: Vector
			// (or its sink) is broken on that host. The join is on
			// `vps_name`, the host identity present on BOTH sides:
			// node_exporter series carry it via the relabel (SD_HOSTNAME ->
			// vps_name), and nn:log_lines_15m is grouped by nn_project
			// which - one Vector agent per VPS - IS the host hostname, so
			// label_replace copies it into vps_name. Per-host, not
			// per-project: a shared host's Vector ships ALL its projects'
			// lines under one stream, so log silence is only observable at
			// host granularity.
			alert: 'VectorSilent',
			expr: 'max by (vps_name) (up{job="node"}) == 1 unless on (vps_name) (label_replace(nn:log_lines_15m, "vps_name", "$1", "nn_project", "(.+)") > 0)',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'No logs from VPS {{ $labels.vps_name }}',
				description:
					'VPS {{ $labels.vps_name }} is up (node_exporter answers) but VictoriaLogs received zero log lines from it in 15 minutes - Vector or its sink is broken on that host.',
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
 * Caddy's access-log logger field is `http.log.access.logN` (per-server
 * suffix), so the filter must run AFTER `unpack_json` (the raw `_msg`
 * carries the suffix, so a pre-unpack phrase match on the bare name
 * fails) and match it as a prefix regex. `unpack_json` defaults to
 * `_msg`, which carries the Caddy JSON body once the Vector sink maps
 * `message -> _msg` (see vector-toml.ts). The host label is emitted as
 * `request.host`; the consuming HTTP alerts `label_replace` it to `host`.
 */
const CADDY_ACCESS_FILTER =
	'| unpack_json | filter logger:~"^http\\.log\\.access"'

export const VLOGS_RECORDING_RULE_GROUP: RuleGroup = {
	name: 'logs-derived',
	type: 'vlogs',
	interval: '60s',
	rules: [
		{
			// Grouped by nn_project, which is the VPS hostname (one Vector
			// agent per VPS). VectorSilent joins it into `vps_name`.
			record: 'nn:log_lines_15m',
			expr: '_time:15m | stats by (nn_project) count() as value',
		},
		{
			record: 'nn:http_requests_5m',
			expr: `_time:5m ${CADDY_ACCESS_FILTER} | stats by (request.host) count() as value`,
		},
		{
			record: 'nn:http_5xx_5m',
			expr: `_time:5m ${CADDY_ACCESS_FILTER} status:>=500 | stats by (request.host) count() as value`,
		},
		{
			record: 'nn:http_duration_p95_5m',
			expr: `_time:5m ${CADDY_ACCESS_FILTER} | stats by (request.host) quantile(0.95, duration) as value`,
		},
	],
}
