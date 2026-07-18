import { describe, expect, it } from 'vitest'

import { resolveEntityState } from './load-state.ts'

import type { LoadState } from './load-state.ts'

describe('resolveEntityState', () => {
	it('reports present with the data when the lookup succeeded with a value', () => {
		const state: LoadState<{ id: number } | null> = {
			kind: 'ok',
			data: { id: 7 },
		}
		expect(resolveEntityState(state)).toEqual({
			status: 'present',
			data: { id: 7 },
		})
	})

	it('reports not_found - not an error - when the lookup succeeded but found nothing', () => {
		const state: LoadState<{ id: number } | null> = {
			kind: 'ok',
			data: null,
		}
		expect(resolveEntityState(state)).toEqual({ status: 'not_found' })
	})

	it('reports failed and hands back the failing state for an upstream error', () => {
		const state: LoadState<{ id: number } | null> = {
			kind: 'upstream_error',
			message: 'boom',
		}
		expect(resolveEntityState(state)).toEqual({ status: 'failed', state })
	})

	it('reports failed for a missing-config state', () => {
		const state: LoadState<{ id: number } | null> = {
			kind: 'missing_config',
			varName: 'CLOUDFLARE_API_TOKEN',
			message: 'unset',
		}
		expect(resolveEntityState(state)).toEqual({ status: 'failed', state })
	})
})
