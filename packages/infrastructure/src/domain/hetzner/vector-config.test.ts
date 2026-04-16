import { describe, expect, it } from 'vitest'

import { selectVectorConfig } from './vector-config.ts'

describe('selectVectorConfig', () => {
	it('returns undefined pair when input is null', () => {
		expect(selectVectorConfig(null)).toEqual({
			vectorToml: undefined,
			vectorEnv: undefined,
		})
	})

	it('renders both toml and env when input is provided', () => {
		const result = selectVectorConfig({
			clientId: 'nextnode',
			project: 'acme-web',
			vlUrl: 'http://vl.tail0.ts.net:9428',
		})

		expect(result.vectorToml).toContain('docker')
		expect(result.vectorEnv).toContain('NN_CLIENT_ID=nextnode')
		expect(result.vectorEnv).toContain('NN_PROJECT=acme-web')
		expect(result.vectorEnv).toContain(
			'NN_VL_URL=http://vl.tail0.ts.net:9428',
		)
	})
})
