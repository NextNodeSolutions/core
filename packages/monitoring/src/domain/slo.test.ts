import type { MonitoringSloConfig } from '@nextnode-solutions/infrastructure/config/types'
import { describe, expect, it } from 'vitest'

import {
	SRE_BURN_RATE_WINDOWS,
	computeBaselineErrorRatio,
	computeBurnRateThresholds,
	computeErrorBudgetMinutes,
} from './slo.ts'

const FOUR_NINES: MonitoringSloConfig = {
	availability: 99.99,
	latencyMsP95: 200,
	latencyMsP99: 500,
	windowDays: 30,
}

const THREE_NINES: MonitoringSloConfig = {
	availability: 99.9,
	latencyMsP95: 500,
	latencyMsP99: undefined,
	windowDays: 30,
}

const TWO_NINES: MonitoringSloConfig = {
	availability: 99,
	latencyMsP95: 1000,
	latencyMsP99: undefined,
	windowDays: 7,
}

describe('computeBaselineErrorRatio', () => {
	it('returns 0.001 for 99.9% availability', () => {
		expect(computeBaselineErrorRatio(THREE_NINES)).toBeCloseTo(0.001, 10)
	})

	it('returns 0.0001 for 99.99% availability', () => {
		expect(computeBaselineErrorRatio(FOUR_NINES)).toBeCloseTo(0.0001, 10)
	})

	it('returns 0.01 for 99% availability', () => {
		expect(computeBaselineErrorRatio(TWO_NINES)).toBeCloseTo(0.01, 10)
	})

	it('returns 0 when the SLO is 100% availability', () => {
		const perfect: MonitoringSloConfig = {
			...THREE_NINES,
			availability: 100,
		}
		expect(computeBaselineErrorRatio(perfect)).toBe(0)
	})
})

describe('computeErrorBudgetMinutes', () => {
	it('gives 43.2 minutes per 30 days for 99.9% availability', () => {
		expect(computeErrorBudgetMinutes(THREE_NINES)).toBeCloseTo(43.2, 5)
	})

	it('gives 4.32 minutes per 30 days for 99.99% availability', () => {
		expect(computeErrorBudgetMinutes(FOUR_NINES)).toBeCloseTo(4.32, 5)
	})

	it('scales with window length', () => {
		// 99% availability, 7 days → 7 * 24 * 60 * 0.01 = 100.8 minutes
		expect(computeErrorBudgetMinutes(TWO_NINES)).toBeCloseTo(100.8, 5)
	})

	it('returns 0 when the SLO is 100% availability', () => {
		const perfect: MonitoringSloConfig = {
			...THREE_NINES,
			availability: 100,
		}
		expect(computeErrorBudgetMinutes(perfect)).toBe(0)
	})
})

describe('SRE_BURN_RATE_WINDOWS', () => {
	it('has the three canonical pairs from the SRE workbook', () => {
		expect(SRE_BURN_RATE_WINDOWS).toHaveLength(3)
		expect(SRE_BURN_RATE_WINDOWS.map(w => w.multiplier)).toEqual([
			14.4, 6, 1,
		])
	})

	it('has two page alerts and one ticket alert', () => {
		const severities = SRE_BURN_RATE_WINDOWS.map(w => w.severity)
		expect(severities.filter(s => s === 'page')).toHaveLength(2)
		expect(severities.filter(s => s === 'ticket')).toHaveLength(1)
	})

	it('uses long > short window for every pair', () => {
		// Simple shape check: short window strings are shorter duration units
		const longWindows = SRE_BURN_RATE_WINDOWS.map(w => w.longWindow)
		const shortWindows = SRE_BURN_RATE_WINDOWS.map(w => w.shortWindow)
		expect(longWindows).toEqual(['1h', '6h', '3d'])
		expect(shortWindows).toEqual(['5m', '30m', '6h'])
	})
})

describe('computeBurnRateThresholds', () => {
	it('returns one threshold per SRE window', () => {
		const thresholds = computeBurnRateThresholds(THREE_NINES)
		expect(thresholds).toHaveLength(SRE_BURN_RATE_WINDOWS.length)
	})

	it('computes error ratios for 99.9% SLO', () => {
		const thresholds = computeBurnRateThresholds(THREE_NINES)
		// 0.001 baseline × multipliers
		expect(thresholds[0]?.errorRatio).toBeCloseTo(0.0144, 6)
		expect(thresholds[1]?.errorRatio).toBeCloseTo(0.006, 6)
		expect(thresholds[2]?.errorRatio).toBeCloseTo(0.001, 6)
	})

	it('computes error ratios for 99.99% SLO (10x stricter)', () => {
		const thresholds = computeBurnRateThresholds(FOUR_NINES)
		// 0.0001 baseline × multipliers
		expect(thresholds[0]?.errorRatio).toBeCloseTo(0.00144, 6)
		expect(thresholds[1]?.errorRatio).toBeCloseTo(0.0006, 6)
		expect(thresholds[2]?.errorRatio).toBeCloseTo(0.0001, 6)
	})

	it('preserves window metadata from SRE_BURN_RATE_WINDOWS', () => {
		const thresholds = computeBurnRateThresholds(THREE_NINES)
		expect(thresholds[0]).toMatchObject({
			severity: 'page',
			longWindow: '1h',
			shortWindow: '5m',
			multiplier: 14.4,
		})
		expect(thresholds[2]).toMatchObject({
			severity: 'ticket',
			longWindow: '3d',
			shortWindow: '6h',
			multiplier: 1,
		})
	})

	it('does not mutate the shared SRE_BURN_RATE_WINDOWS array', () => {
		const before = JSON.stringify(SRE_BURN_RATE_WINDOWS)
		computeBurnRateThresholds(THREE_NINES)
		expect(JSON.stringify(SRE_BURN_RATE_WINDOWS)).toBe(before)
	})
})
