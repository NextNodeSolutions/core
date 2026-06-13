import type { RuleGroup } from './alert-rule.ts'

/** External-view HTTPS probes (blackbox_exporter, PRD P4). */
export const UPTIME_RULE_GROUP: RuleGroup = {
	name: 'uptime',
	rules: [
		{
			alert: 'ProbeFailed',
			expr: 'probe_success{job="blackbox"} == 0',
			for: '3m',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Probe failed for {{ $labels.instance }}',
				description:
					'External HTTPS probe of {{ $labels.instance }} has been failing for 3 minutes. The visitor view is broken - check DNS, Caddy and the app.',
			},
		},
		{
			alert: 'CertExpirySoon',
			expr: '(probe_ssl_earliest_cert_expiry - time()) / 86400 < 14',
			for: '1h',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Certificate of {{ $labels.instance }} expires < 14d',
				description:
					'The TLS certificate served at {{ $labels.instance }} expires in under 14 days - Caddy auto-renewal has failed. Check the Caddy logs.',
			},
		},
	],
}

/**
 * HTTP truth from inside (Caddy access logs): the alert expressions join
 * the `nn:http_*` recording rules the vlogs vmalert remote-writes into
 * VictoriaMetrics (see VLOGS_RECORDING_RULE_GROUP). Those rules group by
 * the LogsQL field `request.host`, so the alert series carry a dotted
 * `request.host` label, not `host`. `label_replace` copies it into a
 * clean `host` label so the `{{ $labels.host }}` annotations resolve (the
 * binary ops still match on the shared `request.host`, so adding `host`
 * is purely additive).
 */
const HOST_FROM_REQUEST_HOST = (series: string): string =>
	`label_replace(${series}, "host", "$1", "request.host", "(.+)")`

const HTTP_5XX = HOST_FROM_REQUEST_HOST('nn:http_5xx_5m')
const HTTP_REQUESTS = HOST_FROM_REQUEST_HOST('nn:http_requests_5m')
const HTTP_P95 = HOST_FROM_REQUEST_HOST('nn:http_duration_p95_5m')

export const HTTP_RULE_GROUP: RuleGroup = {
	name: 'http',
	rules: [
		{
			alert: 'Http5xxRateHigh',
			expr: `(${HTTP_5XX} / ${HTTP_REQUESTS}) > 0.02 and ${HTTP_REQUESTS} > 10`,
			for: '5m',
			labels: { severity: 'critical' },
			annotations: {
				summary: '5xx > 2% on {{ $labels.host }}',
				description:
					'More than 2% of requests to {{ $labels.host }} returned 5xx over the last 5 minutes (from Caddy access logs). Correlate with app logs; consider a rollback.',
			},
		},
		{
			alert: 'HttpLatencyP95High',
			expr: `${HTTP_P95} > 1.5`,
			for: '10m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'p95 latency > 1.5s on {{ $labels.host }}',
				description:
					'The p95 request duration on {{ $labels.host }} exceeded 1.5s for 10 minutes (Caddy access logs). Profile the app and check the database.',
			},
		},
	],
}

/** Database signals (postgres-exporter, PRD P6). */
export const POSTGRES_RULE_GROUP: RuleGroup = {
	name: 'postgres',
	rules: [
		{
			alert: 'PgDown',
			expr: 'pg_up == 0',
			for: '2m',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Postgres down for {{ $labels.project }}',
				description:
					'postgres-exporter on {{ $labels.vps_name }} reports the database unreachable. Read the sidecar logs; restore from backup if needed.',
			},
		},
		{
			alert: 'PgConnectionsHigh',
			expr: 'sum by (vps_name, project) (pg_stat_activity_count) > 0.8 * max by (vps_name, project) (pg_settings_max_connections)',
			for: '10m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Postgres connections > 80% for {{ $labels.project }}',
				description:
					'Active connections exceed 80% of max_connections for {{ $labels.project }} on {{ $labels.vps_name }}. Check the app connection pool for leaks.',
			},
		},
	],
}

/**
 * 3 hours = three missed hourly backups before the alert fires (the sidecar
 * runs `@hourly`, see POSTGRES_BACKUP_SCHEDULE). Tight enough to surface a
 * broken backup pipeline within a few cycles, loose enough to absorb a
 * single slow dump plus the 5-minute scrape cadence without flapping. The
 * `nn_backup_last_success_timestamp_seconds` sample reflects the newest
 * dump's timestamp, surfaced by the monitoring control plane from R2 (PRD P6).
 */
const BACKUP_STALE_HOURS = 3
const SECONDS_PER_HOUR = 3600
const BACKUP_STALE_SECONDS = BACKUP_STALE_HOURS * SECONDS_PER_HOUR

export const BACKUPS_RULE_GROUP: RuleGroup = {
	name: 'backups',
	rules: [
		{
			alert: 'BackupStale',
			expr: `time() - nn_backup_last_success_timestamp_seconds > ${String(BACKUP_STALE_SECONDS)}`,
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Backup stale for {{ $labels.project }}',
				description:
					'No successful pg_dump upload for {{ $labels.project }} in over 3 hours (the sidecar runs hourly). Read the postgres-backup container logs and run a manual backup.',
			},
		},
	],
}
