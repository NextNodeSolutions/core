import { EMPTY_LABEL } from '@/lib/domain/monitoring/format.ts'

const BYTES_PER_KIB = 1024
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
const ROUNDING = 100

export const formatBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes < 0) return EMPTY_LABEL
	if (bytes === 0) return '0 B'
	let scaled = bytes
	let unitIndex = 0
	while (scaled >= BYTES_PER_KIB && unitIndex < UNITS.length - 1) {
		scaled /= BYTES_PER_KIB
		unitIndex += 1
	}
	const rounded = Math.round(scaled * ROUNDING) / ROUNDING
	return `${String(rounded)} ${UNITS[unitIndex]}`
}
