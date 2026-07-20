import { describe, expect, it } from 'vitest'

import { assertLocalExecutionMode } from './hcp-workspace.ts'

describe('assertLocalExecutionMode', () => {
	it('does not throw when the mode is local', () => {
		expect(() =>
			assertLocalExecutionMode('local', 'app-development'),
		).not.toThrow()
	})

	it('throws an actionable error for a remote workspace', () => {
		expect(() =>
			assertLocalExecutionMode('remote', 'app-development'),
		).toThrow(
			'HCP Terraform workspace "app-development" has execution mode "remote", but state-only provisioning requires "local"',
		)
	})

	it('throws when the mode is undefined', () => {
		expect(() =>
			assertLocalExecutionMode(undefined, 'app-development'),
		).toThrow('has execution mode "undefined"')
	})
})
