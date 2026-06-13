import { describe, expect, it } from 'vitest'

import { buildCaddyStatsQuery, parseCaddyStats } from './caddy-stats.ts'

describe('buildCaddyStatsQuery', () => {
	it('filters by the VPS stream and the Caddy access logger after unpack, computing the three aggregates', () => {
		const query = buildCaddyStatsQuery('nn-prod')
		expect(query).toContain('nn_project:"nn-prod"')
		expect(query).toContain('| unpack_json')
		// The logger filter must come AFTER unpack and match the
		// per-server `.logN` suffix as a prefix regex.
		expect(query).toContain(
			String.raw`| filter logger:~"^http\.log\.access"`,
		)
		expect(query.indexOf('| unpack_json')).toBeLessThan(
			query.indexOf('| filter logger'),
		)
		expect(query).toContain('count() as requests')
		expect(query).toContain('count() if (status:>=500) as errors')
		expect(query).toContain('quantile(0.95, duration) as p95')
	})
})

describe('parseCaddyStats', () => {
	it('parses rows and computes the 5xx ratio, sorted by volume', () => {
		const body = [
			JSON.stringify({
				'request.host': 'a.example',
				requests: '10',
				errors: '1',
				p95: '0.2',
			}),
			JSON.stringify({
				'request.host': 'b.example',
				requests: '100',
				errors: '0',
				p95: '0.05',
			}),
		].join('\n')

		expect(parseCaddyStats(body)).toEqual([
			{
				host: 'b.example',
				requests: 100,
				errorRatio: 0,
				p95Seconds: 0.05,
			},
			{
				host: 'a.example',
				requests: 10,
				errorRatio: 0.1,
				p95Seconds: 0.2,
			},
		])
	})

	it('skips blank and unparseable rows', () => {
		const body = '\nnot json\n{"request.host":"x","requests":1}'
		const stats = parseCaddyStats(body)
		expect(stats).toHaveLength(1)
		expect(stats[0]?.host).toBe('x')
	})
})
