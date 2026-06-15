/**
 * Display formatters for the monitoring dashboard.
 *
 * Pure domain helpers: no IO, no ambient clock. Anything time-relative takes
 * an explicit `now` / timezone so renders stay deterministic and testable.
 * French copy and unit thresholds match the design handoff 1:1.
 */

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_DAY = 86_400
const HOURS_PER_DAY = 24
const MS_PER_SECOND = 1_000
const GB_PER_TB = 1_000
const MB_PER_GB = 1_000
const TB_DECIMALS = 2
const MILLIS_DIGITS = 3
const DEFAULT_TIME_ZONE = 'Europe/Paris'

/** Uptime / age of a duration in seconds → `1j 1h`, `2h 30m`, `5m`. */
export function formatUptime(totalSeconds: number): string {
	const days = Math.floor(totalSeconds / SECONDS_PER_DAY)
	const hours = Math.floor(
		(totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR,
	)
	const minutes = Math.floor(
		(totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
	)
	if (days > 0) return `${days}j ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m`
}

/** Relative past time → `il y a 5s`, `il y a 3h`, `il y a 2j`. */
export function formatRelative(fromMs: number, nowMs: number): string {
	const seconds = Math.floor((nowMs - fromMs) / MS_PER_SECOND)
	if (seconds < SECONDS_PER_MINUTE) return `il y a ${seconds}s`
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
	if (minutes < SECONDS_PER_MINUTE) return `il y a ${minutes}m`
	const hours = Math.floor(minutes / SECONDS_PER_MINUTE)
	if (hours < HOURS_PER_DAY) return `il y a ${hours}h`
	return `il y a ${Math.floor(hours / HOURS_PER_DAY)}j`
}

/** Network traffic given in gigabytes → `1.50 TB`, `214.6 GB`, `500 MB`. */
export function formatTrafficGb(gigabytes: number): string {
	if (gigabytes >= GB_PER_TB) {
		return `${(gigabytes / GB_PER_TB).toFixed(TB_DECIMALS)} TB`
	}
	if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`
	return `${(gigabytes * MB_PER_GB).toFixed(0)} MB`
}

/** Whole-percent label → `13%`. */
export function formatPercent(percent: number): string {
	return `${Math.round(percent)}%`
}

/** Locale-grouped integer count → `1 000 000`. */
export function formatCount(count: number): string {
	return count.toLocaleString('fr-FR')
}

/** Wall-clock `HH:MM:SS` in the given timezone. */
export function formatTime(
	ms: number,
	timeZone: string = DEFAULT_TIME_ZONE,
): string {
	return new Intl.DateTimeFormat('fr-FR', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).format(ms)
}

/** Live-tail clock `HH:MM:SS.mmm` in the given timezone. */
export function formatClock(
	ms: number,
	timeZone: string = DEFAULT_TIME_ZONE,
): string {
	const millis = String(
		((ms % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND,
	).padStart(MILLIS_DIGITS, '0')
	return `${formatTime(ms, timeZone)}.${millis}`
}
