import { isRecord } from '#/kernel/guards.ts'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	renderVmalertMetricRulesYaml,
	renderVmalertVlogsRulesYaml,
} from './vmalert-rules.ts'

interface ParsedGroup {
	readonly name: unknown
	readonly type: unknown
	readonly rules: ReadonlyArray<Record<string, unknown>>
}

function parseGroups(yaml: string): ReadonlyArray<ParsedGroup> {
	const parsed: unknown = parse(yaml)
	if (!isRecord(parsed) || !Array.isArray(parsed.groups)) {
		throw new Error('invalid rules file shape')
	}
	return parsed.groups.filter(isRecord).map(group => ({
		name: group.name,
		type: group.type,
		rules: Array.isArray(group.rules) ? group.rules.filter(isRecord) : [],
	}))
}

function severityOf(rule: Record<string, unknown>): unknown {
	if (!isRecord(rule.labels)) return undefined
	return rule.labels.severity
}

describe('renderVmalertMetricRulesYaml', () => {
	const groups = parseGroups(renderVmalertMetricRulesYaml())
	const alerts = groups.flatMap(group =>
		group.rules.filter(rule => typeof rule.alert === 'string'),
	)

	it('covers the PRD catalogue: 21 routed alerts plus the Watchdog', () => {
		const names = alerts
			.map(rule => String(rule.alert))
			.toSorted((a, b) => a.localeCompare(b))
		expect(names).toEqual(
			[
				'VpsDown',
				'HighCpu',
				'MemoryPressure',
				'DiskUsageHigh',
				'DiskWillFillIn24h',
				'InodesExhausted',
				'ContainerGone',
				'ContainerRestartLoop',
				'ContainerOomKilled',
				'ContainerCpuThrottled',
				'Http5xxRateHigh',
				'HttpLatencyP95High',
				'ProbeFailed',
				'CertExpirySoon',
				'PgDown',
				'PgConnectionsHigh',
				'BackupStale',
				'WalgBaseBackupStale',
				'WalgBaseBackupMissing',
				'VectorSilent',
				'Watchdog',
				'ActiveSeriesBudgetExceeded',
			].toSorted((a, b) => a.localeCompare(b)),
		)
	})

	it('scopes VpsDown to the node job so a dead postgres-exporter cannot fake a VPS outage', () => {
		const vpsDown = alerts.find(rule => rule.alert === 'VpsDown')
		expect(vpsDown?.expr).toBe('up{job="node"} == 0')
		expect(vpsDown?.for).toBe('4m')
		expect(vpsDown?.labels).toEqual({ severity: 'critical' })
	})

	it('keeps the Watchdog always firing with the non-routable severity', () => {
		const watchdog = alerts.find(rule => rule.alert === 'Watchdog')
		expect(watchdog?.expr).toBe('vector(1)')
		expect(watchdog?.labels).toEqual({ severity: 'none' })
		expect(watchdog?.for).toBeUndefined()
	})

	it('gives every routed alert a critical or warning severity and annotations', () => {
		for (const rule of alerts) {
			if (rule.alert === 'Watchdog') continue
			expect(['critical', 'warning']).toContain(severityOf(rule))
			expect(rule.annotations).toBeDefined()
		}
	})

	it('fires BackupStale after two missed daily dumps (50h) without a successful backup', () => {
		const stale = alerts.find(rule => rule.alert === 'BackupStale')
		expect(stale?.expr).toBe(
			'time() - nn_backup_last_success_timestamp_seconds > 180000',
		)
	})

	it('escalates wal-g base backups from warning (26h) to critical (50h) in disjoint bands', () => {
		const warn = alerts.find(rule => rule.alert === 'WalgBaseBackupStale')
		const crit = alerts.find(rule => rule.alert === 'WalgBaseBackupMissing')
		// Warning fires only inside [26h, 50h] so it never overlaps the critical.
		expect(warn?.expr).toBe(
			'time() - nn_walg_base_backup_last_success_timestamp_seconds > 93600 and time() - nn_walg_base_backup_last_success_timestamp_seconds <= 180000',
		)
		expect(severityOf(warn ?? {})).toBe('warning')
		// Critical fires past 50h (two missed daily cycles) - the upper warning bound.
		expect(crit?.expr).toBe(
			'time() - nn_walg_base_backup_last_success_timestamp_seconds > 180000',
		)
		expect(severityOf(crit ?? {})).toBe('critical')
	})

	it('contains no vlogs group - LogsQL evaluation lives in the dedicated file', () => {
		expect(groups.every(group => typeof group.type === 'undefined')).toBe(
			true,
		)
	})
})

describe('renderVmalertVlogsRulesYaml', () => {
	const groups = parseGroups(renderVmalertVlogsRulesYaml())

	it('declares a single vlogs recording group', () => {
		expect(groups).toHaveLength(1)
		expect(groups[0]?.type).toBe('vlogs')
	})

	it('records only - alerts always evaluate in the metrics vmalert', () => {
		const rules = groups[0]?.rules ?? []
		expect(rules.length).toBeGreaterThan(0)
		for (const rule of rules) {
			expect(typeof rule.record).toBe('string')
			expect(rule.alert).toBeUndefined()
		}
	})

	it('records the per-project line count VectorSilent joins on', () => {
		const lineCount = groups[0]?.rules.find(
			rule => rule.record === 'nn:log_lines_15m',
		)
		expect(lineCount?.expr).toBe(
			'_time:15m | stats by (nn_project) count() as value',
		)
	})
})
