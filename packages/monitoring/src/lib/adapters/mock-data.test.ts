import { describe, expect, it } from 'vitest'

import { mockVpsSeries } from '@/lib/adapters/mock-data.ts'
import { mockFleetErrorCount, mockFleetLogs } from '@/lib/adapters/mock-logs.ts'

/**
 * The mock fixtures back `MOCK_DATA=1` offline UI work. Their ONE non-obvious
 * contract is that they must be RANGE-DEPENDENT: an operator who changes the
 * time filter has to see the windowed stats move. A regression to range-flat
 * fixtures (the previous bug) would make every range render identical numbers,
 * so these tests assert the windowed quantities actually differ per window -
 * and that the series VALUES stay reload-stable (no wall clock in the value).
 */

const HOURS_PER_DAY = 24
const MS_PER_HOUR = 3_600_000

const errorCount = (logs: ReadonlyArray<{ level: string | null }>): number =>
	logs.filter(line => line.level === 'error').length

const mean = (points: ReadonlyArray<{ v: number }>): number =>
	points.reduce((sum, point) => sum + point.v, 0) / points.length

describe('mockFleetLogs', () => {
	it('scales the line count with the window', () => {
		expect(mockFleetLogs(1).length).toBeLessThan(mockFleetLogs(6).length)
		expect(mockFleetLogs(6).length).toBeLessThan(
			mockFleetLogs(HOURS_PER_DAY).length,
		)
	})

	it('produces strictly more errors as the window widens', () => {
		const oneHour = errorCount(mockFleetLogs(1))
		const sixHours = errorCount(mockFleetLogs(6))
		const oneDay = errorCount(mockFleetLogs(HOURS_PER_DAY))

		expect(oneHour).toBeLessThan(sixHours)
		expect(sixHours).toBeLessThan(oneDay)
	})

	it('spreads timestamps across the whole window, not a fixed cluster', () => {
		const dayLogs = mockFleetLogs(HOURS_PER_DAY)
		const times = dayLogs.map(line => Date.parse(line.time))
		const oldestAgeMs = Math.max(...times.map(time => Date.now() - time))

		// The oldest line reaches deep into the 24h window (the old fixture
		// clustered everything inside ~9 minutes regardless of range).
		expect(oldestAgeMs).toBeGreaterThan(20 * MS_PER_HOUR)
		// Every line still sits inside the window and in the past.
		for (const time of times) {
			expect(Date.now() - time).toBeGreaterThan(0)
			expect(Date.now() - time).toBeLessThanOrEqual(
				HOURS_PER_DAY * MS_PER_HOUR,
			)
		}
	})
})

describe('mockFleetErrorCount', () => {
	it('rises strictly with the window (the windowed error stat must move)', () => {
		expect(mockFleetErrorCount(1)).toBeLessThan(mockFleetErrorCount(6))
		expect(mockFleetErrorCount(6)).toBeLessThan(
			mockFleetErrorCount(HOURS_PER_DAY),
		)
	})

	it('agrees with the error lines in the matching mock window', () => {
		const fromLogs = mockFleetLogs(6).filter(
			line => line.level === 'error',
		).length
		expect(mockFleetErrorCount(6)).toBe(fromLogs)
	})
})

describe('mockVpsSeries', () => {
	it('returns a different window MEAN per range (drives "CPU moyen")', () => {
		const oneHour = mean(mockVpsSeries('nn-prod', 'cpu', 1))
		const sixHours = mean(mockVpsSeries('nn-prod', 'cpu', 6))
		const oneDay = mean(mockVpsSeries('nn-prod', 'cpu', HOURS_PER_DAY))

		expect(oneHour).not.toBeCloseTo(sixHours, 1)
		expect(sixHours).not.toBeCloseTo(oneDay, 1)
		// The trend rises with age, so a wider window averages a higher arc.
		expect(oneHour).toBeLessThan(sixHours)
		expect(sixHours).toBeLessThan(oneDay)
	})

	it('keeps the sample VALUES reload-stable (no wall clock in the value)', () => {
		const first = mockVpsSeries('nn-prod', 'cpu', 6).map(point => point.v)
		const second = mockVpsSeries('nn-prod', 'cpu', 6).map(point => point.v)

		expect(first).toEqual(second)
	})

	it('never emits a negative sample after the windowed trend', () => {
		for (const hours of [1, 6, HOURS_PER_DAY]) {
			for (const point of mockVpsSeries('nn-internals', 'load', hours)) {
				expect(point.v).toBeGreaterThanOrEqual(0)
			}
		}
	})
})
