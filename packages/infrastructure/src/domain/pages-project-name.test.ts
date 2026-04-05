import { describe, expect, it } from 'vitest'

import { computePagesProjectName } from './pages-project-name.ts'

describe('computePagesProjectName', () => {
	it('returns the base name unchanged in production', () => {
		expect(computePagesProjectName('gardefroidclim', 'production')).toBe(
			'gardefroidclim',
		)
	})

	it('appends -dev in development', () => {
		expect(computePagesProjectName('gardefroidclim', 'development')).toBe(
			'gardefroidclim-dev',
		)
	})

	it('returns the base name unchanged for package environments (none)', () => {
		expect(computePagesProjectName('my-lib', 'none')).toBe('my-lib')
	})
})
