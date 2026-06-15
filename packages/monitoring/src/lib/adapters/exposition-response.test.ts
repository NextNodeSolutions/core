import { describe, expect, it } from 'vitest'

import { runExpositionEndpoint } from './exposition-response.ts'

describe('runExpositionEndpoint', () => {
	it('serves the rendered exposition as text/plain;version=0.0.4 with status 200', async () => {
		const exposition = '# TYPE nn_up gauge\nnn_up 1\n'
		const response = await runExpositionEndpoint(
			'test',
			async () => exposition,
		)

		expect(response.status).toBe(200)
		// vmagent negotiates this exact format version; a different content-type
		// makes it drop the whole scrape.
		expect(response.headers.get('content-type')).toBe(
			'text/plain; version=0.0.4',
		)
		expect(await response.text()).toBe(exposition)
	})

	it('returns a plain 500 carrying the error message when the render throws', async () => {
		const response = await runExpositionEndpoint('test', async () => {
			throw new Error('r2 list failed')
		})

		expect(response.status).toBe(500)
		expect(response.headers.get('content-type')).toBe('text/plain')
		expect(await response.text()).toBe('r2 list failed')
	})
})
