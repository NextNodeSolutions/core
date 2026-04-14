import { describe, expect, it } from 'vitest'

import { buildSummary, parseSemanticReleaseOutput } from './publish-result.ts'

describe('parseSemanticReleaseOutput', () => {
	it('detects a published release with version', () => {
		const output = `
Analyzing commits...
Published release 2.1.0 on default channel
`
		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'published', version: '2.1.0' })
	})

	it('detects no-release when no relevant changes', () => {
		const output = `
Analyzing commits...
There are no relevant changes, so no new version is released.
`
		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'no-release' })
	})

	it('detects no-release with "no new version" message', () => {
		const output = 'no new version to publish'

		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'no-release' })
	})

	it('returns failure for unrecognized output', () => {
		const output = 'ENOENT: something went terribly wrong'

		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'failure' })
	})

	it('returns failure for empty output', () => {
		const result = parseSemanticReleaseOutput('')

		expect(result).toEqual({ status: 'failure' })
	})
})

describe('buildSummary', () => {
	it('formats published summary with version', () => {
		const summary = buildSummary(
			{ status: 'published', version: '3.0.0' },
			'@scope/pkg',
		)
		expect(summary).toBe(
			'### :white_check_mark: Published @scope/pkg v3.0.0',
		)
	})

	it('formats no-release summary', () => {
		const summary = buildSummary({ status: 'no-release' }, '@scope/pkg')
		expect(summary).toBe('### :fast_forward: No new release for @scope/pkg')
	})

	it('formats failure summary', () => {
		const summary = buildSummary({ status: 'failure' }, '@scope/pkg')
		expect(summary).toBe('### :x: Publish failed for @scope/pkg')
	})
})
