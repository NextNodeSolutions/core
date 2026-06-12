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
		const vectorConfig = selectVectorConfig({
			clientId: 'nextnode',
			project: 'acme-web',
			vlUrl: 'http://vl.tail0.ts.net:9428',
		})

		expect(vectorConfig.vectorToml).toContain('docker')
		expect(vectorConfig.vectorEnv).toContain('NN_CLIENT_ID=nextnode')
		expect(vectorConfig.vectorEnv).toContain('NN_PROJECT=acme-web')
		expect(vectorConfig.vectorEnv).toContain(
			'NN_VL_URL=http://vl.tail0.ts.net:9428',
		)
	})
})
