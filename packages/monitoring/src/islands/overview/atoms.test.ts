import { describe, expect, it } from 'vitest'

import { parseWindow } from '@/islands/overview/atoms.ts'

/**
 * The client trust boundary. `parseWindow` validates the /api/overview JSON
 * before it reaches the island's atoms: a malformed payload must THROW (a loud
 * failure the data region surfaces), never slip through as a half-empty window
 * the UI would render as "all clear". `range`/`windowHours` come from the
 * REQUESTED range, not from whatever the server echoes back.
 */

const validPayload = {
	stats: [],
	stream: [],
	notices: [],
}

describe('parseWindow', () => {
	it('derives range and windowHours from the requested range, not the payload', () => {
		const window = parseWindow(validPayload, '6h')

		expect(window.range).toBe('6h')
		expect(window.windowHours).toBe(6)
	})

	it('clamps an unknown range to the 1h live window', () => {
		expect(parseWindow(validPayload, 'garbage').windowHours).toBe(1)
	})

	it('throws when the payload is not an object', () => {
		expect(() => parseWindow(null, 'live')).toThrow()
		expect(() => parseWindow('nope', 'live')).toThrow()
		expect(() => parseWindow([], 'live')).toThrow()
	})

	it('throws when a required array field is missing or wrong-typed', () => {
		expect(() => parseWindow({ stream: [], notices: [] }, 'live')).toThrow()
		expect(() =>
			parseWindow({ stats: {}, stream: [], notices: [] }, 'live'),
		).toThrow()
		expect(() =>
			parseWindow({ stats: [], stream: [], notices: 'x' }, 'live'),
		).toThrow()
	})
})
