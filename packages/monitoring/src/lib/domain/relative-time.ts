const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_BEFORE_ABSOLUTE_DATE = 30
const ISO_DATE_LENGTH = 10

export const formatIsoDate = (isoString: string): string =>
	isoString.slice(0, ISO_DATE_LENGTH)

/**
 * Render an ISO timestamp as a compact relative label ("just now", "5m ago",
 * "3h ago", "2d ago", or the ISO date for anything older than a month).
 *
 * Takes `nowMs` as a parameter so callers control the clock — keeps this
 * helper pure and deterministic under test.
 */
export const formatRelativeTime = (
	isoString: string,
	nowMs: number,
): string => {
	const date = new Date(isoString)
	const elapsedMs = nowMs - date.getTime()
	if (Number.isNaN(elapsedMs)) return '—'
	const minutes = Math.round(elapsedMs / MS_PER_MINUTE)
	if (minutes < 1) return 'just now'
	if (minutes < MINUTES_PER_HOUR) return `${String(minutes)}m ago`
	const hours = Math.round(minutes / MINUTES_PER_HOUR)
	if (hours < HOURS_PER_DAY) return `${String(hours)}h ago`
	const days = Math.round(hours / HOURS_PER_DAY)
	if (days < DAYS_BEFORE_ABSOLUTE_DATE) return `${String(days)}d ago`
	return formatIsoDate(date.toISOString())
}
