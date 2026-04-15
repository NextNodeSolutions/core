import { describe, expect, it } from 'vitest'

import { renderVectorEnv } from './vector-env.ts'

const fields = {
	clientId: 'nextnode',
	project: 'acme-web',
	vlUrl: 'http://monitoring.tail1234.ts.net:9428',
} as const

describe('renderVectorEnv', () => {
	it('renders all three fields', () => {
		const result = renderVectorEnv(fields)
		expect(result).toContain('NN_CLIENT_ID=nextnode')
		expect(result).toContain('NN_PROJECT=acme-web')
		expect(result).toContain(
			'NN_VL_URL=http://monitoring.tail1234.ts.net:9428',
		)
	})

	it('produces exactly 3 lines', () => {
		const lines = renderVectorEnv(fields).split('\n')
		expect(lines).toHaveLength(3)
	})

	it('uses KEY=value format on every line', () => {
		for (const line of renderVectorEnv(fields).split('\n')) {
			expect(line).toMatch(/^NN_[A-Z_]+=.+$/)
		}
	})

	it('contains no extra fields', () => {
		const keys = renderVectorEnv(fields)
			.split('\n')
			.map(line => line.split('=')[0])
		expect(keys).toStrictEqual(['NN_CLIENT_ID', 'NN_PROJECT', 'NN_VL_URL'])
	})
})
