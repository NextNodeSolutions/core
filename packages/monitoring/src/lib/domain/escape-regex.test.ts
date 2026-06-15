import { describe, expect, it } from 'vitest'

import { escapeRegex } from './escape-regex.ts'

describe('escapeRegex', () => {
	it('leaves a plain kebab slug untouched', () => {
		expect(escapeRegex('my-project')).toBe('my-project')
	})

	it('escapes regex metacharacters so the value matches literally', () => {
		expect(escapeRegex('a.b*c')).toBe(String.raw`a\.b\*c`)
		expect(escapeRegex('(x)|y')).toBe(String.raw`\(x\)\|y`)
		expect(escapeRegex('a\\b')).toBe(String.raw`a\\b`)
	})
})
