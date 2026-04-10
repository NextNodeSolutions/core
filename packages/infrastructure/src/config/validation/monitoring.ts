import type {
	MonitoringConfig,
	MonitoringHealthcheckConfig,
	MonitoringSloConfig,
} from '../types.ts'
import { DEFAULT_MONITORING_HEALTHCHECK, isRecord } from '../types.ts'
import type { ValidationResult } from './result.ts'

function validateSloSection(
	raw: Record<string, unknown>,
): ValidationResult<MonitoringSloConfig> {
	const errors: string[] = []

	const availability = raw['availability']
	if (typeof availability !== 'number' || availability <= 0 || availability > 100)
		errors.push('[monitoring.slo] availability must be in (0, 100]')

	const latencyMsP95 = raw['latency_ms_p95']
	if (typeof latencyMsP95 !== 'number' || latencyMsP95 <= 0)
		errors.push('[monitoring.slo] latency_ms_p95 must be > 0')

	const latencyMsP99 = raw['latency_ms_p99']
	if (latencyMsP99 !== undefined && (typeof latencyMsP99 !== 'number' || latencyMsP99 <= 0))
		errors.push('[monitoring.slo] latency_ms_p99 must be > 0 when present')

	if (
		typeof latencyMsP95 === 'number' &&
		typeof latencyMsP99 === 'number' &&
		latencyMsP99 < latencyMsP95
	)
		errors.push('[monitoring.slo] latency_ms_p99 must be >= latency_ms_p95')

	const windowDays = raw['window_days'] ?? 30
	if (typeof windowDays !== 'number' || windowDays < 1)
		errors.push('[monitoring.slo] window_days must be >= 1')

	if (errors.length > 0) return { ok: false, errors }

	return {
		ok: true,
		section: {
			availability: availability as number,
			latencyMsP95: latencyMsP95 as number,
			latencyMsP99: latencyMsP99 === undefined ? undefined : (latencyMsP99 as number),
			windowDays: windowDays as number,
		},
	}
}

function validateHealthcheckSection(
	raw: Record<string, unknown>,
): ValidationResult<MonitoringHealthcheckConfig> {
	const errors: string[] = []

	const path = raw['path'] ?? DEFAULT_MONITORING_HEALTHCHECK.path
	if (typeof path !== 'string' || !path.startsWith('/'))
		errors.push('[monitoring.healthcheck] path must start with /')

	const intervalSeconds = raw['interval_seconds'] ?? DEFAULT_MONITORING_HEALTHCHECK.intervalSeconds
	if (typeof intervalSeconds !== 'number' || intervalSeconds < 1)
		errors.push('[monitoring.healthcheck] interval_seconds must be >= 1')

	const timeoutMs = raw['timeout_ms'] ?? DEFAULT_MONITORING_HEALTHCHECK.timeoutMs
	if (typeof timeoutMs !== 'number' || timeoutMs <= 0)
		errors.push('[monitoring.healthcheck] timeout_ms must be > 0')

	const expectedStatus = raw['expected_status'] ?? DEFAULT_MONITORING_HEALTHCHECK.expectedStatus
	if (typeof expectedStatus !== 'number' || expectedStatus < 100 || expectedStatus > 599)
		errors.push('[monitoring.healthcheck] expected_status must be in [100, 599]')

	if (errors.length > 0) return { ok: false, errors }

	return {
		ok: true,
		section: {
			path: path as string,
			intervalSeconds: intervalSeconds as number,
			timeoutMs: timeoutMs as number,
			expectedStatus: expectedStatus as number,
		},
	}
}

export function validateMonitoringSection(
	raw: unknown,
): ValidationResult<MonitoringConfig | false> {
	if (raw === undefined) return { ok: true, section: false }

	if (!isRecord(raw))
		return { ok: false, errors: ['[monitoring] must be a table when present'] }

	const errors: string[] = []

	const endpoint = raw['endpoint']
	if (typeof endpoint !== 'string' || !endpoint.startsWith('https://'))
		errors.push('[monitoring] endpoint must be an HTTPS URL')

	const sloRaw = raw['slo']
	let slo: MonitoringSloConfig | undefined
	if (sloRaw !== undefined) {
		if (!isRecord(sloRaw)) {
			errors.push('[monitoring.slo] must be a table')
		} else {
			const sloResult = validateSloSection(sloRaw)
			if (!sloResult.ok) errors.push(...sloResult.errors)
			else slo = sloResult.section
		}
	}

	const healthcheckRaw = raw['healthcheck']
	let healthcheck: MonitoringHealthcheckConfig = DEFAULT_MONITORING_HEALTHCHECK
	if (healthcheckRaw !== undefined) {
		if (!isRecord(healthcheckRaw)) {
			errors.push('[monitoring.healthcheck] must be a table')
		} else {
			const hcResult = validateHealthcheckSection(healthcheckRaw)
			if (!hcResult.ok) errors.push(...hcResult.errors)
			else healthcheck = hcResult.section
		}
	}

	if (errors.length > 0) return { ok: false, errors }

	return {
		ok: true,
		section: {
			endpoint: endpoint as string,
			slo,
			healthcheck,
		},
	}
}
