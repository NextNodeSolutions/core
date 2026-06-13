import type { RuleGroup } from './alert-rule.ts'

/** Root filesystem selectors shared by the disk rules. */
const ROOT_FS =
	'node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'
const ROOT_FS_SIZE =
	'node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}'
const ROOT_FS_FILES_FREE =
	'node_filesystem_files_free{mountpoint="/",fstype!~"tmpfs|overlay"}'
const ROOT_FS_FILES =
	'node_filesystem_files{mountpoint="/",fstype!~"tmpfs|overlay"}'

/**
 * Machine signals (node_exporter, PRD §7). `up{job="node"}` is the VPS
 * liveness contract: the node job only carries node_exporter targets, so
 * a dead postgres-exporter or cAdvisor cannot fake a VPS outage.
 */
export const MACHINE_RULE_GROUP: RuleGroup = {
	name: 'machine',
	rules: [
		{
			alert: 'VpsDown',
			expr: 'up{job="node"} == 0',
			for: '4m',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'VPS {{ $labels.vps_name }} is down',
				description:
					'node_exporter on {{ $labels.vps_name }} (project {{ $labels.project }}) has been unreachable over the tailnet for 4 minutes. Check the Hetzner console; recover the server if it is dead.',
			},
		},
		{
			alert: 'HighCpu',
			expr: '100 - (avg by (vps_name, project, environment, client_id) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 90',
			for: '15m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'CPU > 90% on {{ $labels.vps_name }}',
				description:
					'Sustained CPU above 90% for 15 minutes on {{ $labels.vps_name }}. Identify the container via cAdvisor metrics and consider resizing.',
			},
		},
		{
			alert: 'MemoryPressure',
			expr: '(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 < 10',
			for: '10m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Available memory < 10% on {{ $labels.vps_name }}',
				description:
					'Less than 10% memory available for 10 minutes on {{ $labels.vps_name }}. Check for leaks or upgrade the server type.',
			},
		},
		{
			alert: 'DiskUsageHigh',
			expr: `(1 - ${ROOT_FS} / ${ROOT_FS_SIZE}) * 100 > 85`,
			for: '30m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Root filesystem > 85% on {{ $labels.vps_name }}',
				description:
					'Root filesystem usage above 85% for 30 minutes on {{ $labels.vps_name }}. Run docker system prune and inspect volumes.',
			},
		},
		{
			alert: 'DiskWillFillIn24h',
			expr: `predict_linear(${ROOT_FS}[6h], 86400) < 0`,
			for: '30m',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Disk will fill within 24h on {{ $labels.vps_name }}',
				description:
					'Linear prediction over the last 6h says the root filesystem of {{ $labels.vps_name }} fills within 24 hours. Intervene before saturation.',
			},
		},
		{
			alert: 'InodesExhausted',
			expr: `(${ROOT_FS_FILES_FREE} / ${ROOT_FS_FILES}) * 100 < 10`,
			for: '30m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Free inodes < 10% on {{ $labels.vps_name }}',
				description:
					'Less than 10% inodes free on {{ $labels.vps_name }}. Hunt small-file hoards (Docker layers are the usual suspect).',
			},
		},
	],
}

/** Container signals (cAdvisor, PRD §7). */
export const CONTAINERS_RULE_GROUP: RuleGroup = {
	name: 'containers',
	rules: [
		{
			alert: 'ContainerGone',
			expr: 'time() - container_last_seen{container_name=~".+"} > 300',
			for: '2m',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Container {{ $labels.container_name }} disappeared',
				description:
					'Container {{ $labels.container_name }} on {{ $labels.vps_name }} has not been seen by cAdvisor for over 5 minutes. Check docker compose state and the container logs in VictoriaLogs.',
			},
		},
		{
			alert: 'ContainerRestartLoop',
			expr: 'changes(container_start_time_seconds{container_name=~".+"}[15m]) > 3',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Container {{ $labels.container_name }} restart loop',
				description:
					'Container {{ $labels.container_name }} on {{ $labels.vps_name }} restarted more than 3 times in 15 minutes. Read its logs in VictoriaLogs.',
			},
		},
		{
			alert: 'ContainerOomKilled',
			expr: 'increase(container_oom_events_total{container_name=~".+"}[5m]) > 0',
			labels: { severity: 'critical' },
			annotations: {
				summary: 'Container {{ $labels.container_name }} OOM-killed',
				description:
					'Container {{ $labels.container_name }} on {{ $labels.vps_name }} was OOM-killed. Raise its memory limit or fix the leak.',
			},
		},
		{
			alert: 'ContainerCpuThrottled',
			expr: '(rate(container_cpu_cfs_throttled_periods_total{container_name=~".+"}[5m]) / rate(container_cpu_cfs_periods_total{container_name=~".+"}[5m])) > 0.25',
			for: '15m',
			labels: { severity: 'warning' },
			annotations: {
				summary: 'Container {{ $labels.container_name }} CPU-throttled',
				description:
					'Container {{ $labels.container_name }} on {{ $labels.vps_name }} is throttled on more than 25% of CPU periods. Review its CPU limits.',
			},
		},
	],
}
