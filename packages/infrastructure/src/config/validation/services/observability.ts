import { isRecord } from '#/kernel/guards.ts'
import {
	integer,
	maxValue,
	minValue,
	number,
	pipe,
	regex,
	string,
} from 'valibot'

import { collectFieldErrors, nonEmptyString, runSchema } from '../valibot.ts'

import type { ObservabilityServiceConfig } from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'
import type { GenericSchema } from 'valibot'

// VictoriaLogs/VictoriaMetrics `-retentionPeriod` duration: a positive
// integer with a single unit suffix (h/d/w/y), e.g. "30d". Months are
// covered by the dedicated `metrics_retention_months` integer field.
const RETENTION_PATTERN = /^[1-9][0-9]*[hdwy]$/

const logsRetentionSchema: GenericSchema<unknown, string> = pipe(
	string(
		'services.observability.logs_retention must be a duration string like "30d"',
	),
	regex(
		RETENTION_PATTERN,
		'services.observability.logs_retention must be a positive integer with an h/d/w/y suffix (e.g. "30d")',
	),
)

// Sanity bounds on the metrics retention: at least a month (the unit),
// at most 10 years - far beyond any conceivable SLA need.
const MIN_RETENTION_MONTHS = 1
const MAX_RETENTION_MONTHS = 120

const metricsRetentionMonthsSchema: GenericSchema<unknown, number> = pipe(
	number(
		'services.observability.metrics_retention_months must be an integer number of months',
	),
	integer(
		'services.observability.metrics_retention_months must be an integer number of months',
	),
	minValue(
		MIN_RETENTION_MONTHS,
		'services.observability.metrics_retention_months must be at least 1',
	),
	maxValue(
		MAX_RETENTION_MONTHS,
		'services.observability.metrics_retention_months must be at most 120',
	),
)

const logsVhostSchema = nonEmptyString(
	'services.observability.logs_vhost must be a non-empty hostname',
)
const metricsVhostSchema = nonEmptyString(
	'services.observability.metrics_vhost must be a non-empty hostname',
)

export function validateObservabilityService(
	raw: unknown,
): ValidationResult<ObservabilityServiceConfig> {
	if (!isRecord(raw)) {
		return {
			ok: false,
			errors: ['[services.observability] must be a table'],
		}
	}

	const logsRetention = runSchema(logsRetentionSchema, raw['logs_retention'])
	const metricsRetentionMonths = runSchema(
		metricsRetentionMonthsSchema,
		raw['metrics_retention_months'],
	)
	const logsVhost = runSchema(logsVhostSchema, raw['logs_vhost'])
	const metricsVhost = runSchema(metricsVhostSchema, raw['metrics_vhost'])

	if (
		!logsRetention.ok ||
		!metricsRetentionMonths.ok ||
		!logsVhost.ok ||
		!metricsVhost.ok
	) {
		return {
			ok: false,
			errors: collectFieldErrors(
				logsRetention,
				metricsRetentionMonths,
				logsVhost,
				metricsVhost,
			),
		}
	}

	return {
		ok: true,
		section: {
			logsRetention: logsRetention.section,
			metricsRetentionMonths: metricsRetentionMonths.section,
			logsVhost: logsVhost.section,
			metricsVhost: metricsVhost.section,
		},
	}
}
