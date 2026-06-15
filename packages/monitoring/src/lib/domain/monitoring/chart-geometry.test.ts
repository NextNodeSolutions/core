import { describe, expect, it } from 'vitest'

import {
	areaChartGeometry,
	buildLinePath,
	multiLineGeometry,
	radialGaugeGeometry,
	sparklineGeometry,
} from './chart-geometry.ts'

describe('buildLinePath', () => {
	it('moves to the first point then lines to the rest', () => {
		expect(
			buildLinePath([
				{ x: 0, y: 0 },
				{ x: 10, y: 5 },
			]),
		).toBe('M0.0 0.0 L10.0 5.0')
	})

	it('is empty for no points', () => {
		expect(buildLinePath([])).toBe('')
	})
})

describe('areaChartGeometry', () => {
	const geo = areaChartGeometry({
		values: [0, 50, 100],
		width: 200,
		height: 100,
		min: 0,
		max: 100,
	})

	it('maps the max value to the top and the min to the baseline', () => {
		// inner band: top = 12, height = 100 - 12 - 22 = 66 → baseline 78
		expect(geo.points[2]?.y).toBeCloseTo(12, 5)
		expect(geo.points[0]?.y).toBeCloseTo(78, 5)
		expect(geo.points[1]?.y).toBeCloseTo(45, 5)
	})

	it('emits a closed area path and an open line path', () => {
		expect(geo.linePath.startsWith('M')).toBe(true)
		expect(geo.areaPath.endsWith('Z')).toBe(true)
	})

	it('produces five evenly spaced y-axis ticks spanning the domain', () => {
		expect(geo.ticks).toHaveLength(5)
		expect(geo.ticks[0]?.value).toBeCloseTo(0, 5)
		expect(geo.ticks[4]?.value).toBeCloseTo(100, 5)
	})

	it('places thresholds at their projected height', () => {
		const withThreshold = areaChartGeometry({
			values: [0, 100],
			width: 200,
			height: 100,
			min: 0,
			max: 100,
			thresholds: [{ value: 90, label: 'crit', color: 'red' }],
		})
		expect(withThreshold.thresholds[0]).toMatchObject({
			label: 'crit',
			color: 'red',
		})
		// 90% of the way up sits near the top (small y)
		expect(withThreshold.thresholds[0]!.y).toBeLessThan(20)
	})

	it('returns empty paths and no points for an empty series', () => {
		const empty = areaChartGeometry({
			values: [],
			width: 200,
			height: 100,
			min: 0,
			max: 100,
		})
		expect(empty.points).toHaveLength(0)
		expect(empty.linePath).toBe('')
		expect(empty.areaPath).toBe('')
	})

	it('pins a single point to the left edge', () => {
		const single = areaChartGeometry({
			values: [50],
			width: 200,
			height: 100,
			min: 0,
			max: 100,
		})
		expect(single.points).toHaveLength(1)
		// PAD_LEFT = 40
		expect(single.points[0]?.x).toBeCloseTo(40, 5)
	})

	it('auto-scales the axis with headroom when no max is supplied', () => {
		const auto = areaChartGeometry({
			values: [0, 80],
			width: 200,
			height: 100,
			min: 0,
		})
		// domainMax = 80 * 1.15 = 92, so the peak (80) sits below the top band
		const topY = 12
		const baselineY = 78
		expect(auto.points[1]?.y).toBeGreaterThan(topY)
		expect(auto.points[1]?.y).toBeLessThan(baselineY)
		expect(auto.ticks.at(-1)?.value).toBeCloseTo(92, 5)
	})
})

describe('sparklineGeometry', () => {
	it('anchors the last point at the right edge and the peak near the top', () => {
		const geo = sparklineGeometry([0, 10], 100, 34)
		expect(geo.lastX).toBeCloseTo(100, 5)
		// peak (10) → height - 3 - (height - 6) = 34 - 3 - 28 = 3
		expect(geo.lastY).toBeCloseTo(3, 5)
		expect(geo.linePath.startsWith('M')).toBe(true)
	})

	it('does not divide by zero on a flat series', () => {
		const geo = sparklineGeometry([5, 5, 5], 100, 34)
		expect(Number.isFinite(geo.lastY)).toBe(true)
	})

	it('returns empty paths for an empty series without crashing', () => {
		const geo = sparklineGeometry([], 100, 34)
		expect(geo.linePath).toBe('')
		expect(geo.areaPath).toBe('')
		expect(Number.isFinite(geo.lastX)).toBe(true)
		expect(Number.isFinite(geo.lastY)).toBe(true)
	})

	it('pins a single point to the left edge', () => {
		const geo = sparklineGeometry([7], 100, 34)
		expect(geo.lastX).toBeCloseTo(0, 5)
		expect(geo.linePath.startsWith('M0.0')).toBe(true)
	})
})

describe('radialGaugeGeometry', () => {
	const size = 96
	const stroke = 9
	const circumference = 2 * Math.PI * ((size - stroke) / 2)

	it('offsets the full circumference at 0% and nothing at 100%', () => {
		expect(radialGaugeGeometry(0, size, stroke).dashOffset).toBeCloseTo(
			circumference,
			5,
		)
		expect(radialGaugeGeometry(100, size, stroke).dashOffset).toBeCloseTo(
			0,
			5,
		)
	})

	it('clamps out-of-range values', () => {
		expect(radialGaugeGeometry(150, size, stroke).dashOffset).toBeCloseTo(
			0,
			5,
		)
		expect(radialGaugeGeometry(-20, size, stroke).dashOffset).toBeCloseTo(
			circumference,
			5,
		)
	})

	it('centres the arc and exposes the radius', () => {
		const geo = radialGaugeGeometry(50, size, stroke)
		expect(geo.center).toBeCloseTo(48, 5)
		expect(geo.radius).toBeCloseTo(43.5, 5)
		expect(geo.dashOffset).toBeCloseTo(circumference / 2, 5)
	})
})

describe('multiLineGeometry', () => {
	it('builds one path per series and three reference ticks', () => {
		const geo = multiLineGeometry(
			[
				[0, 50, 100],
				[100, 50, 0],
			],
			{ width: 200, height: 120, max: 100 },
		)
		expect(geo.lines).toHaveLength(2)
		expect(geo.lines[0]?.startsWith('M')).toBe(true)
		expect(geo.ticks.map(tick => tick.value)).toEqual([0, 50, 100])
	})

	it('never emits NaN or Infinity when max is zero', () => {
		const geo = multiLineGeometry([[0, 0, 0]], {
			width: 200,
			height: 120,
			max: 0,
		})
		expect(geo.lines.join(' ')).not.toMatch(/NaN|Infinity/)
		expect(geo.ticks.every(tick => Number.isFinite(tick.y))).toBe(true)
	})

	it('drops non-finite samples from the projected path', () => {
		const geo = multiLineGeometry(
			[[10, Number.NaN, Number.POSITIVE_INFINITY, 30]],
			{
				width: 200,
				height: 120,
				max: 100,
			},
		)
		expect(geo.lines.join(' ')).not.toMatch(/NaN|Infinity/)
	})
})

describe('non-finite sample hardening', () => {
	it('areaChartGeometry never emits NaN or Infinity coordinates', () => {
		const geo = areaChartGeometry({
			values: [10, Number.NaN, Number.POSITIVE_INFINITY, 30],
			width: 200,
			height: 100,
			min: 0,
			max: 100,
		})
		expect(geo.linePath).not.toMatch(/NaN|Infinity/)
		expect(geo.areaPath).not.toMatch(/NaN|Infinity/)
		expect(geo.points.every(point => Number.isFinite(point.y))).toBe(true)
	})

	it('areaChartGeometry falls back when the supplied max is zero', () => {
		const geo = areaChartGeometry({
			values: [0, 0, 0],
			width: 200,
			height: 100,
			min: 0,
			max: 0,
		})
		expect(geo.linePath).not.toMatch(/NaN|Infinity/)
		expect(geo.points.every(point => Number.isFinite(point.y))).toBe(true)
	})

	it('sparklineGeometry never emits NaN or Infinity coordinates', () => {
		const geo = sparklineGeometry(
			[5, Number.NaN, Number.NEGATIVE_INFINITY, 9],
			100,
			34,
		)
		expect(geo.linePath).not.toMatch(/NaN|Infinity/)
		expect(geo.areaPath).not.toMatch(/NaN|Infinity/)
		expect(Number.isFinite(geo.lastX)).toBe(true)
		expect(Number.isFinite(geo.lastY)).toBe(true)
	})
})
