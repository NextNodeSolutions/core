const BYTES_PER_KIB = 1024
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
const ROUNDING = 100

export const formatBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes < 0) return '—'
	if (bytes === 0) return '0 B'
	let value = bytes
	let unitIndex = 0
	while (value >= BYTES_PER_KIB && unitIndex < UNITS.length - 1) {
		value /= BYTES_PER_KIB
		unitIndex += 1
	}
	const rounded = Math.round(value * ROUNDING) / ROUNDING
	return `${String(rounded)} ${UNITS[unitIndex]}`
}
