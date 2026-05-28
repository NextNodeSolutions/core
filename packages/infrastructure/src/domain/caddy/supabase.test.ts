import { describe, expect, it } from 'vitest'

import {
	buildSupabaseRoutes,
	buildSupabaseSubjects,
	supabaseApiHostname,
	supabaseStudioHostname,
} from './supabase.ts'

describe('supabaseApiHostname', () => {
	it('prefixes the deploy domain with api.', () => {
		expect(supabaseApiHostname('acme.example.com')).toBe(
			'api.acme.example.com',
		)
	})
})

describe('supabaseStudioHostname', () => {
	it('prefixes the deploy domain with studio.', () => {
		expect(supabaseStudioHostname('acme.example.com')).toBe(
			'studio.acme.example.com',
		)
	})
})

describe('buildSupabaseRoutes', () => {
	it('returns the kong route then the studio route, in that order', () => {
		const routes = buildSupabaseRoutes('acme.example.com')
		expect(routes).toHaveLength(2)
		expect(routes[0]?.match[0]?.host).toStrictEqual([
			'api.acme.example.com',
		])
		expect(routes[1]?.match[0]?.host).toStrictEqual([
			'studio.acme.example.com',
		])
	})

	it('reverse-proxies the api host to kong:8000', () => {
		const [kong] = buildSupabaseRoutes('acme.example.com')
		expect(kong).toStrictEqual({
			match: [{ host: ['api.acme.example.com'] }],
			handle: [
				{
					handler: 'reverse_proxy',
					upstreams: [{ dial: 'kong:8000' }],
				},
			],
			terminal: true,
		})
	})

	it('gates the studio host behind http_basic with username=supabase and env-placeholder password, then reverse-proxies to studio:3000', () => {
		const [, studio] = buildSupabaseRoutes('acme.example.com')
		expect(studio).toStrictEqual({
			match: [{ host: ['studio.acme.example.com'] }],
			handle: [
				{
					handler: 'authentication',
					providers: {
						http_basic: {
							accounts: [
								{
									username: 'supabase',
									password: '{env.DASHBOARD_PASSWORD}',
								},
							],
						},
					},
				},
				{
					handler: 'reverse_proxy',
					upstreams: [{ dial: 'studio:3000' }],
				},
			],
			terminal: true,
		})
	})

	it('orders the studio basic-auth handler before reverse_proxy', () => {
		const [, studio] = buildSupabaseRoutes('acme.example.com')
		expect(studio?.handle[0]?.handler).toBe('authentication')
		expect(studio?.handle[1]?.handler).toBe('reverse_proxy')
	})

	it('keeps the dashboard password as an env placeholder, never a literal hash', () => {
		const json = JSON.stringify(buildSupabaseRoutes('acme.example.com'))
		expect(json).toContain('{env.DASHBOARD_PASSWORD}')
		expect(json).not.toMatch(/\$2[aby]\$/)
	})

	it('derives api + studio hosts from a dev deploy domain', () => {
		const routes = buildSupabaseRoutes('dev.acme.example.com')
		expect(routes[0]?.match[0]?.host).toStrictEqual([
			'api.dev.acme.example.com',
		])
		expect(routes[1]?.match[0]?.host).toStrictEqual([
			'studio.dev.acme.example.com',
		])
	})
})

describe('buildSupabaseSubjects', () => {
	it('returns the api host then the studio host, matching the route order', () => {
		expect(buildSupabaseSubjects('acme.example.com')).toStrictEqual([
			'api.acme.example.com',
			'studio.acme.example.com',
		])
	})
})
