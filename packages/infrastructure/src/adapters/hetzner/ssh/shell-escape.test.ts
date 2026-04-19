import { describe, expect, it } from 'vitest'

import { shellEscape } from './shell-escape.ts'

describe('shellEscape', () => {
	it('wraps a plain string in single quotes', () => {
		expect(shellEscape('my-app')).toBe("'my-app'")
	})

	it('neutralises command substitution', () => {
		expect(shellEscape('x$(whoami)')).toBe("'x$(whoami)'")
	})

	it('neutralises command chaining with semicolons', () => {
		expect(shellEscape('x;rm -rf /')).toBe("'x;rm -rf /'")
	})

	it('neutralises backticks', () => {
		expect(shellEscape('x`id`')).toBe("'x`id`'")
	})

	it('escapes embedded single quotes', () => {
		expect(shellEscape("it's")).toBe("'it'\\''s'")
	})

	it('escapes multiple single quotes', () => {
		expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'")
	})

	it('handles empty strings', () => {
		expect(shellEscape('')).toBe("''")
	})

	it('preserves spaces without expansion', () => {
		expect(shellEscape('a b c')).toBe("'a b c'")
	})

	it('preserves newlines as literal characters inside quotes', () => {
		expect(shellEscape('a\nb')).toBe("'a\nb'")
	})
})
