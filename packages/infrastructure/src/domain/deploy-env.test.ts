import { describe, expect, it } from 'vitest'

import { computeDeployEnv } from './deploy-env.ts'

describe('computeDeployEnv', () => {
	describe('with domain', () => {
		it('uses the domain as-is in production', () => {
			const result = computeDeployEnv({
				projectType: 'static',
				environment: 'production',
				domain: 'example.com',
				pagesProjectName: 'my-site',
			})
			expect(result).toStrictEqual({ SITE_URL: 'https://example.com' })
		})

		it('prefixes dev. in development', () => {
			const result = computeDeployEnv({
				projectType: 'static',
				environment: 'development',
				domain: 'example.com',
				pagesProjectName: 'my-site-dev',
			})
			expect(result).toStrictEqual({
				SITE_URL: 'https://dev.example.com',
			})
		})

		it('works the same for app projects', () => {
			const result = computeDeployEnv({
				projectType: 'app',
				environment: 'production',
				domain: 'api.example.com',
				pagesProjectName: 'irrelevant',
			})
			expect(result).toStrictEqual({
				SITE_URL: 'https://api.example.com',
			})
		})
	})

	describe('without domain', () => {
		it('falls back to pages.dev for static in production', () => {
			const result = computeDeployEnv({
				projectType: 'static',
				environment: 'production',
				domain: undefined,
				pagesProjectName: 'my-site',
			})
			expect(result).toStrictEqual({
				SITE_URL: 'https://my-site.pages.dev',
			})
		})

		it('falls back to dev pages.dev for static in development', () => {
			const result = computeDeployEnv({
				projectType: 'static',
				environment: 'development',
				domain: undefined,
				pagesProjectName: 'my-site-dev',
			})
			expect(result).toStrictEqual({
				SITE_URL: 'https://my-site-dev.pages.dev',
			})
		})

		it('throws for app projects', () => {
			expect(() =>
				computeDeployEnv({
					projectType: 'app',
					environment: 'production',
					domain: undefined,
					pagesProjectName: 'irrelevant',
				}),
			).toThrow('app projects require a domain for SITE_URL')
		})
	})
})
