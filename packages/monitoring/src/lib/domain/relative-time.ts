const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_BEFORE_ABSOLUTE_DATE = 30

const ISO_DATE_LENGTH = 10

const parseIsoMs = (isoString: string): number | null => {
	const ms = Date.parse(isoString)
	return Number.isFinite(ms) ? ms : null
}

const toIsoDate = (ms: number): string =>
	new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH)

export const formatIsoDate = (isoString: string): string => {
	const ms = parseIsoMs(isoString)
	return ms === null ? '—' : toIsoDate(ms)
}

export const formatRelativeTime = (
	isoString: string,
	nowMs: number,
): string => {
	const ms = parseIsoMs(isoString)
	if (ms === null) return '—'
	const diffSeconds = Math.round((nowMs - ms) / MS_PER_SECOND)
	const minutes = Math.round(diffSeconds / SECONDS_PER_MINUTE)
	if (minutes < 1) return 'just now'
	if (minutes < MINUTES_PER_HOUR) return `${String(minutes)}m ago`
	const hours = Math.round(minutes / MINUTES_PER_HOUR)
	if (hours < HOURS_PER_DAY) return `${String(hours)}h ago`
	const days = Math.round(hours / HOURS_PER_DAY)
	if (days < DAYS_BEFORE_ABSOLUTE_DATE) return `${String(days)}d ago`
	return toIsoDate(ms)
}
