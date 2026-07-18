import { describe, expect, it } from 'vitest'

import { runPhase } from '@/lib/domain/github/run-status.ts'

describe('runPhase', () => {
	it('keeps queued (waiting/queued) distinct from pending (pending/requested)', () => {
		expect(runPhase({ status: 'waiting', conclusion: null })).toBe('queued')
		expect(runPhase({ status: 'queued', conclusion: null })).toBe('queued')
		expect(runPhase({ status: 'pending', conclusion: null })).toBe(
			'pending',
		)
		expect(runPhase({ status: 'requested', conclusion: null })).toBe(
			'pending',
		)
	})

	it('classifies an in-progress run as running', () => {
		expect(runPhase({ status: 'in_progress', conclusion: null })).toBe(
			'running',
		)
	})

	it('classifies completed runs by conclusion', () => {
		expect(runPhase({ status: 'completed', conclusion: 'success' })).toBe(
			'succeeded',
		)
		for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
			expect(runPhase({ status: 'completed', conclusion })).toBe('failed')
		}
	})

	it('falls back to unknown for unrecognised statuses and conclusions', () => {
		expect(runPhase({ status: 'somenewstatus', conclusion: null })).toBe(
			'unknown',
		)
		expect(runPhase({ status: 'completed', conclusion: 'neutral' })).toBe(
			'unknown',
		)
		expect(runPhase({ status: 'completed', conclusion: null })).toBe(
			'unknown',
		)
	})
})
