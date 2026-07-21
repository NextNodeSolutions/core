import { describe, expect, it } from 'vitest'

import { selectBackingSecrets } from './service-env.ts'

describe('selectBackingSecrets', () => {
	it('keeps only secrets produced by a backing service, dropping user secrets', () => {
		expect(
			selectBackingSecrets(
				{
					DATABASE_URL: 'postgres://db:5432',
					POSTGRES_PASSWORD: 'pg-pw',
					SESSION_KEY: 'sess-val',
				},
				{ DATABASE_URL: 'postgres', POSTGRES_PASSWORD: 'postgres' },
			),
		).toEqual({
			DATABASE_URL: 'postgres://db:5432',
			POSTGRES_PASSWORD: 'pg-pw',
		})
	})

	it('returns an empty map when no secret has a backing origin', () => {
		expect(selectBackingSecrets({ SESSION_KEY: 'sess-val' }, {})).toEqual(
			{},
		)
	})
})
