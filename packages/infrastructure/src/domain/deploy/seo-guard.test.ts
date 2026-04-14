import { describe, expect, it } from 'vitest'

import { computeSeoGuardFiles } from './seo-guard.ts'

describe('computeSeoGuardFiles', () => {
	it('returns _headers and robots.txt for development', () => {
		const files = computeSeoGuardFiles('development')

		expect(files).toHaveLength(2)
		expect(files[0]?.filename).toBe('_headers')
		expect(files[0]?.content).toContain('X-Robots-Tag: noindex')
		expect(files[1]?.filename).toBe('robots.txt')
		expect(files[1]?.content).toContain('Disallow: /')
	})

	it('returns empty array for production', () => {
		expect(computeSeoGuardFiles('production')).toStrictEqual([])
	})

	it('_headers covers all paths with wildcard', () => {
		const files = computeSeoGuardFiles('development')
		const headers = files.find(f => f.filename === '_headers')

		expect(headers?.content).toMatch(/^\/\*\n/)
	})

	it('robots.txt blocks all user agents', () => {
		const files = computeSeoGuardFiles('development')
		const robots = files.find(f => f.filename === 'robots.txt')

		expect(robots?.content).toContain('User-agent: *')
	})
})
