import { describe, expect, it } from 'vitest'

import { validateWorkerServices } from './deploy-worker-services.ts'

const deploy = (
	services: Record<string, unknown>,
): Record<string, unknown> => ({ services })

describe('validateWorkerServices', () => {
	it('parses a static-assets-only Worker (entry = false + assets)', () => {
		const result = validateWorkerServices(
			deploy({ web: { entry: false, assets: 'dist' } }),
		)

		expect(result.errors).toEqual([])
		expect(result.services.web).toMatchObject({
			entry: false,
			assets: 'dist',
			observability: true,
		})
	})

	it('requires assets when entry is false', () => {
		const result = validateWorkerServices(deploy({ web: { entry: false } }))

		expect(result.errors).toEqual([
			'deploy.services.web: `entry = false` (static-assets-only Worker) requires `assets` - declare the built assets directory',
		])
		expect(result.services).toEqual({})
	})

	it('forbids assets on a scripted Worker (the entry owns the derivation)', () => {
		const result = validateWorkerServices(
			deploy({ web: { assets: 'dist/client' } }),
		)

		expect(result.errors).toEqual([
			'deploy.services.web: `assets` is only valid with `entry = false` - a scripted Worker derives its assets directory from its entry',
		])
		expect(result.services).toEqual({})
	})

	it('defaults a missing entry to the @astrojs/cloudflare bundle path', () => {
		const result = validateWorkerServices(deploy({ web: {} }))

		expect(result.errors).toEqual([])
		expect(result.services.web).toMatchObject({
			entry: 'dist/server/entry.mjs',
		})
	})
})
