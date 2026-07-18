import { describe, expect, it } from 'vitest'

import {
	vpsRunDisplayStatus,
	vpsRunEnvironment,
} from '@/lib/domain/github/vps-deploy-run.ts'

describe('vpsRunDisplayStatus', () => {
	it('maps a successful completed run to ready', () => {
		expect(
			vpsRunDisplayStatus({ status: 'completed', conclusion: 'success' }),
		).toBe('ready')
	})

	it('maps in-flight statuses to building', () => {
		for (const status of ['queued', 'waiting', 'in_progress']) {
			expect(vpsRunDisplayStatus({ status, conclusion: null })).toBe(
				'building',
			)
		}
	})

	it('maps failed conclusions to error', () => {
		for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
			expect(
				vpsRunDisplayStatus({ status: 'completed', conclusion }),
			).toBe('error')
		}
	})

	it('maps a skipped completed run to idle', () => {
		expect(
			vpsRunDisplayStatus({ status: 'completed', conclusion: 'skipped' }),
		).toBe('idle')
	})
})

describe('vpsRunEnvironment', () => {
	it('marks a default-branch run as production', () => {
		expect(vpsRunEnvironment('main', 'main')).toBe('production')
	})

	it('marks any other branch as preview', () => {
		expect(vpsRunEnvironment('feat/x', 'main')).toBe('preview')
	})

	it('marks a missing branch as preview', () => {
		expect(vpsRunEnvironment(null, 'main')).toBe('preview')
	})
})
