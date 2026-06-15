import { describe, expect, it } from 'vitest'

import {
	formatClock,
	formatCount,
	formatDurationSeconds,
	formatPercent,
	formatRelative,
	formatTime,
	formatTrafficGb,
	formatUptime,
} from './format.ts'

describe('formatUptime', () => {
	it('shows days and hours past one day', () => {
		expect(formatUptime(90_000)).toBe('1j 1h')
	})

	it('shows hours and minutes below one day', () => {
		expect(formatUptime(3_600)).toBe('1h 0m')
		expect(formatUptime(9_000)).toBe('2h 30m')
	})

	it('shows only minutes below one hour', () => {
		expect(formatUptime(300)).toBe('5m')
		expect(formatUptime(0)).toBe('0m')
	})
})

describe('formatRelative', () => {
	const now = Date.UTC(2026, 5, 15, 12, 0, 0)

	it('counts seconds under a minute', () => {
		expect(formatRelative(now - 5_000, now)).toBe('il y a 5s')
	})

	it('counts minutes under an hour', () => {
		expect(formatRelative(now - 300_000, now)).toBe('il y a 5m')
	})

	it('counts hours under a day', () => {
		expect(formatRelative(now - 3 * 3_600_000, now)).toBe('il y a 3h')
	})

	it('counts days beyond a day', () => {
		expect(formatRelative(now - 2 * 86_400_000, now)).toBe('il y a 2j')
	})
})

describe('formatTrafficGb', () => {
	it('renders terabytes above 1000 GB', () => {
		expect(formatTrafficGb(1_500)).toBe('1.50 TB')
	})

	it('renders gigabytes with one decimal between 1 and 1000', () => {
		expect(formatTrafficGb(214.6)).toBe('214.6 GB')
		expect(formatTrafficGb(1)).toBe('1.0 GB')
	})

	it('renders megabytes below 1 GB', () => {
		expect(formatTrafficGb(0.5)).toBe('500 MB')
	})
})

describe('formatPercent', () => {
	it('rounds to the nearest whole percent', () => {
		expect(formatPercent(12.7)).toBe('13%')
		expect(formatPercent(0)).toBe('0%')
	})
})

describe('formatCount', () => {
	it('groups thousands with the French locale separator', () => {
		expect(formatCount(1_000_000)).toMatch(/^1\D000\D000$/)
		expect(formatCount(42)).toBe('42')
	})
})

describe('formatTime / formatClock', () => {
	const stamp = Date.UTC(2026, 5, 15, 12, 32, 18, 423)

	it('formats summer wall-clock time in Europe/Paris (DST, UTC+2)', () => {
		expect(formatTime(stamp, 'Europe/Paris')).toBe('14:32:18')
	})

	it('formats winter wall-clock time in Europe/Paris (no DST, UTC+1)', () => {
		// December 15, 12:00 UTC → 13:00 in Paris (CET = UTC+1)
		const winter = Date.UTC(2026, 11, 15, 12, 0, 0)
		expect(formatTime(winter, 'Europe/Paris')).toBe('13:00:00')
	})

	it('formats wall-clock time in UTC unchanged', () => {
		const winter = Date.UTC(2026, 11, 15, 12, 0, 0)
		expect(formatTime(winter, 'UTC')).toBe('12:00:00')
	})

	it('appends milliseconds for the live clock', () => {
		expect(formatClock(stamp, 'Europe/Paris')).toBe('14:32:18.423')
	})

	it('renders a dash instead of a clock for an unparsable timestamp', () => {
		expect(formatTime(Number.NaN)).toBe('-')
		expect(formatClock(Number.NaN)).toBe('-')
	})

	it('renders a dash for a non-finite timestamp', () => {
		expect(formatTime(Number.POSITIVE_INFINITY)).toBe('-')
	})
})

describe('formatDurationSeconds', () => {
	it('rounds a positive elapsed duration to whole seconds', () => {
		expect(formatDurationSeconds(12_400)).toBe('12s')
		expect(formatDurationSeconds(12_600)).toBe('13s')
	})

	it('clamps a negative elapsed duration to zero (build still running)', () => {
		expect(formatDurationSeconds(-5_000)).toBe('0s')
	})

	it('renders a dash when the elapsed duration is not a number', () => {
		expect(formatDurationSeconds(Number.NaN)).toBe('-')
	})
})
