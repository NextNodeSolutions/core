import { describe, expect, it } from 'vitest'

import { computeInfraFingerprint } from './infra-fingerprint.ts'

describe('computeInfraFingerprint', () => {
	it('returns a 16-character hex string', () => {
		const result = computeInfraFingerprint(['file-a', 'file-b'])
		expect(result).toMatch(/^[0-9a-f]{16}$/)
	})

	it('produces deterministic output for the same input', () => {
		const first = computeInfraFingerprint(['hello', 'world'])
		const second = computeInfraFingerprint(['hello', 'world'])
		expect(first).toBe(second)
	})

	it('produces different output for different input', () => {
		const a = computeInfraFingerprint(['hello', 'world'])
		const b = computeInfraFingerprint(['hello', 'changed'])
		expect(a).not.toBe(b)
	})

	it('is sensitive to file order', () => {
		const a = computeInfraFingerprint(['first', 'second'])
		const b = computeInfraFingerprint(['second', 'first'])
		expect(a).not.toBe(b)
	})

	it('handles empty file contents', () => {
		const result = computeInfraFingerprint(['', ''])
		expect(result).toMatch(/^[0-9a-f]{16}$/)
	})

	it('handles a single file', () => {
		const result = computeInfraFingerprint(['only-one'])
		expect(result).toMatch(/^[0-9a-f]{16}$/)
	})
})
