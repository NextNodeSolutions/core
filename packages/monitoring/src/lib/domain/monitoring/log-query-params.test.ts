import { describe, expect, it } from 'vitest'

import {
	buildLogsHref,
	parseLogLevels,
	toggleLevelHref,
} from './log-query-params.ts'
import { LOG_LEVELS } from './log-query.ts'

import type { LogsQuery } from './log-query-params.ts'

const baseQuery: LogsQuery = {
	q: '',
	service: 'all',
	vps: 'all',
	levelsParam: '',
	range: '6h',
}

describe('parseLogLevels', () => {
	it('keeps recognised levels and drops unknown tokens', () => {
		expect(parseLogLevels('warn,bogus,error')).toEqual(['warn', 'error'])
	})

	it('falls back to all levels when empty or fully unrecognised', () => {
		expect(parseLogLevels('')).toEqual([...LOG_LEVELS])
		expect(parseLogLevels('nope')).toEqual([...LOG_LEVELS])
	})
})

describe('buildLogsHref', () => {
	it('omits defaults so the canonical view is a bare /logs', () => {
		expect(buildLogsHref(baseQuery, {})).toBe('/logs')
	})

	it('serialises non-default filter state', () => {
		expect(
			buildLogsHref({ ...baseQuery, q: 'oops', range: '24h' }, {}),
		).toBe('/logs?q=oops&range=24h')
	})

	it('applies overrides, deleting the key on null', () => {
		expect(buildLogsHref(baseQuery, { sel: 'abc' })).toBe('/logs?sel=abc')
		expect(
			buildLogsHref({ ...baseQuery, range: '24h' }, { range: null }),
		).toBe('/logs')
	})
})

describe('toggleLevelHref', () => {
	it('toggling a level off lists the remaining levels', () => {
		expect(toggleLevelHref(baseQuery, [...LOG_LEVELS], 'debug')).toBe(
			'/logs?levels=info%2Cwarn%2Cerror',
		)
	})

	it('toggling the last-off level on collapses levels to the all-state', () => {
		const allButDebug = LOG_LEVELS.filter(level => level !== 'debug')
		expect(toggleLevelHref(baseQuery, allButDebug, 'debug')).toBe(
			'/logs?levels=',
		)
	})
})
