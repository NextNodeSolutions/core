import { describe, expect, it } from 'vitest'

import {
	formatClock,
	formatCount,
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

	it('formats wall-clock time in the given timezone', () => {
		expect(formatTime(stamp, 'Europe/Paris')).toBe('14:32:18')
	})

	it('appends milliseconds for the live clock', () => {
		expect(formatClock(stamp, 'Europe/Paris')).toBe('14:32:18.423')
	})
})
