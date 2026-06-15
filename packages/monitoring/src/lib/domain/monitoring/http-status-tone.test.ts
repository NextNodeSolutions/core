import { describe, expect, it } from 'vitest'

import { httpStatusTone } from './http-status-tone.ts'

describe('httpStatusTone', () => {
	it('classifies at the 400/500 boundaries', () => {
		expect(httpStatusTone(200)).toBe('ok')
		expect(httpStatusTone(399)).toBe('ok')
		expect(httpStatusTone(400)).toBe('clientError')
		expect(httpStatusTone(499)).toBe('clientError')
		expect(httpStatusTone(500)).toBe('serverError')
		expect(httpStatusTone(503)).toBe('serverError')
	})
})
