import { describe, expect, it } from 'vitest'

import { validatePlanetscaleService } from './planetscale.ts'

describe('validatePlanetscaleService', () => {
	it('accepts an empty table (org defaults apply)', () => {
		const parsed = validatePlanetscaleService({})
		expect(parsed).toEqual({ ok: true, section: {} })
	})

	it('accepts cluster_size and region overrides', () => {
		const parsed = validatePlanetscaleService({
			cluster_size: 'PS_10',
			region: 'us-east',
		})
		expect(parsed).toEqual({
			ok: true,
			section: { clusterSize: 'PS_10', region: 'us-east' },
		})
	})

	it('rejects a non-table', () => {
		const parsed = validatePlanetscaleService('nope')
		expect(parsed).toEqual({
			ok: false,
			errors: ['[services.planetscale] must be a table'],
		})
	})

	it('rejects an empty cluster_size', () => {
		const parsed = validatePlanetscaleService({ cluster_size: '' })
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.errors).toContain(
			'services.planetscale.cluster_size must be a non-empty string when set',
		)
	})

	it('rejects a non-string region', () => {
		const parsed = validatePlanetscaleService({ region: 42 })
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.errors).toContain(
			'services.planetscale.region must be a non-empty string when set',
		)
	})
})
