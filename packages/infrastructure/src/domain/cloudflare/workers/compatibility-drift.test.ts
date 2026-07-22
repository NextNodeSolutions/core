import {
	WORKERS_COMPATIBILITY_DATE,
	WORKERS_COMPATIBILITY_FLAGS,
} from '@nextnode-solutions/standards/workers'
import { describe, expect, it } from 'vitest'

import {
	DEFAULT_WORKERS_COMPATIBILITY_DATE,
	WORKERS_COMPATIBILITY_FLAGS as INFRA_WORKERS_COMPATIBILITY_FLAGS,
} from './wrangler-document.ts'

describe('workers compatibility single source', () => {
	it('pins the same date as @nextnode-solutions/standards', () => {
		expect(DEFAULT_WORKERS_COMPATIBILITY_DATE).toBe(
			WORKERS_COMPATIBILITY_DATE,
		)
	})

	it('pins the same flags as @nextnode-solutions/standards', () => {
		expect([...INFRA_WORKERS_COMPATIBILITY_FLAGS]).toEqual([
			...WORKERS_COMPATIBILITY_FLAGS,
		])
	})
})
