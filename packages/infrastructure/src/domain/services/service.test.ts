import { describe, expect, it } from 'vitest'

import type { ServiceEnv } from './service.ts'
import { emptyServiceEnv, mergeServiceEnvs } from './service.ts'

describe('emptyServiceEnv', () => {
	it('returns both channels empty', () => {
		expect(emptyServiceEnv()).toEqual({ public: {}, secret: {} })
	})
})

describe('mergeServiceEnvs', () => {
	it('returns an empty env when no services contribute', () => {
		expect(mergeServiceEnvs([])).toEqual({ public: {}, secret: {} })
	})

	it('keeps channels separate so credentials never leak into the public surface', () => {
		const r2: ServiceEnv = {
			public: { R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' },
			secret: {
				R2_ACCESS_KEY_ID: 'access',
				R2_SECRET_ACCESS_KEY: 'secret',
			},
		}

		expect(mergeServiceEnvs([r2])).toEqual({
			public: { R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' },
			secret: {
				R2_ACCESS_KEY_ID: 'access',
				R2_SECRET_ACCESS_KEY: 'secret',
			},
		})
	})

	it('folds disjoint contributions from multiple services', () => {
		const r2: ServiceEnv = {
			public: { R2_ENDPOINT: 'https://r2.example.com' },
			secret: { R2_ACCESS_KEY_ID: 'r2-key' },
		}
		const d1: ServiceEnv = {
			public: { D1_DATABASE_ID: 'db-id' },
			secret: { D1_TOKEN: 'd1-token' },
		}

		expect(mergeServiceEnvs([r2, d1])).toEqual({
			public: {
				R2_ENDPOINT: 'https://r2.example.com',
				D1_DATABASE_ID: 'db-id',
			},
			secret: { R2_ACCESS_KEY_ID: 'r2-key', D1_TOKEN: 'd1-token' },
		})
	})

	it('throws when two services claim the same public env key', () => {
		const a: ServiceEnv = { public: { SHARED: 'a' }, secret: {} }
		const b: ServiceEnv = { public: { SHARED: 'b' }, secret: {} }

		expect(() => mergeServiceEnvs([a, b])).toThrow(
			'env key "SHARED" collides between two services on the public channel',
		)
	})

	it('throws when two services claim the same secret env key', () => {
		const a: ServiceEnv = { public: {}, secret: { TOKEN: 'a' } }
		const b: ServiceEnv = { public: {}, secret: { TOKEN: 'b' } }

		expect(() => mergeServiceEnvs([a, b])).toThrow(
			'env key "TOKEN" collides between two services on the secret channel',
		)
	})
})
