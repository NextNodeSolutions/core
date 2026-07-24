import { describe, expect, it } from 'vitest'

import { assertWipeDataAllowed } from './teardown.ts'

import type { ServicesConfig } from '#/config/service-config.ts'

const D1: ServicesConfig = { d1: { migrationsFolder: 'drizzle' } }
const R2: ServicesConfig = { r2: { buckets: [{ name: 'assets', cdn: false }] } }
const R2_EMPTY: ServicesConfig = { r2: { buckets: [] } }
const BOTH: ServicesConfig = { ...D1, ...R2 }
const KV_ONLY: ServicesConfig = { kv: { namespaces: [{ name: 'sessions' }] } }

describe('assertWipeDataAllowed', () => {
	it('never throws when wipeData is true, whatever is declared', () => {
		expect(() => assertWipeDataAllowed('app', BOTH, true)).not.toThrow()
		expect(() => assertWipeDataAllowed('app', D1, true)).not.toThrow()
		expect(() => assertWipeDataAllowed('app', R2, true)).not.toThrow()
	})

	it('does not throw when no stateful data is declared', () => {
		expect(() => assertWipeDataAllowed('app', {}, false)).not.toThrow()
		expect(() => assertWipeDataAllowed('app', KV_ONLY, false)).not.toThrow()
		expect(() =>
			assertWipeDataAllowed('app', R2_EMPTY, false),
		).not.toThrow()
	})

	it('throws for D1 alone without the flag', () => {
		expect(() => assertWipeDataAllowed('shop', D1, false)).toThrow(
			/teardown would destroy D1 data for "shop" - re-run with wipe_data/,
		)
	})

	it('throws for R2 buckets alone without the flag', () => {
		expect(() => assertWipeDataAllowed('shop', R2, false)).toThrow(
			/teardown would destroy R2 data for "shop"/,
		)
	})

	it('lists both D1 and R2 when both are declared', () => {
		expect(() => assertWipeDataAllowed('shop', BOTH, false)).toThrow(
			/teardown would destroy D1\/R2 data for "shop"/,
		)
	})
})
