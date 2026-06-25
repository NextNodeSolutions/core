import { describe, expect, it } from 'vitest'

import { validateCronJobs } from './cron.ts'

const SERVICES: ReadonlySet<string> = new Set(['web', 'worker'])

describe('validateCronJobs', () => {
	it('accepts a minimal job and defaults the method to POST', () => {
		const parsed = validateCronJobs(
			[
				{
					name: 'cleanup',
					schedule: '0 3 * * *',
					path: '/api/cron/cleanup',
				},
			],
			SERVICES,
		)

		expect(parsed).toEqual({
			ok: true,
			section: [
				{
					name: 'cleanup',
					schedule: '0 3 * * *',
					path: '/api/cron/cleanup',
					method: 'POST',
				},
			],
		})
	})

	it('keeps an explicit method and service reference', () => {
		const parsed = validateCronJobs(
			[
				{
					name: 'sweep',
					schedule: '*/5 * * * *',
					path: '/internal/sweep',
					method: 'GET',
					service: 'worker',
				},
			],
			SERVICES,
		)

		expect(parsed).toEqual({
			ok: true,
			section: [
				{
					name: 'sweep',
					schedule: '*/5 * * * *',
					path: '/internal/sweep',
					method: 'GET',
					service: 'worker',
				},
			],
		})
	})

	it('treats an absent section as no jobs', () => {
		expect(validateCronJobs(undefined, SERVICES)).toEqual({
			ok: true,
			section: [],
		})
	})

	it('rejects a schedule that is not a 5-field cron expression', () => {
		const parsed = validateCronJobs(
			[{ name: 'c', schedule: '@daily', path: '/x' }],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
		expect(parsed.ok ? [] : parsed.errors).toContain(
			'deploy.cron job "c" schedule must be a standard 5-field cron expression (e.g. "0 3 * * *")',
		)
	})

	it('rejects a path without a leading slash', () => {
		const parsed = validateCronJobs(
			[{ name: 'c', schedule: '0 0 * * *', path: 'api/x' }],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
		expect(parsed.ok ? [] : parsed.errors).toContain(
			'deploy.cron job "c" path must be an absolute request path starting with "/"',
		)
	})

	it('rejects a path containing whitespace, a newline, or a quote', () => {
		for (const path of [
			'/api/c run',
			'/api/c\nrun',
			"/api/'c",
			'/api/"c',
		]) {
			const parsed = validateCronJobs(
				[{ name: 'c', schedule: '0 0 * * *', path }],
				SERVICES,
			)

			expect(parsed.ok).toBe(false)
			expect(parsed.ok ? [] : parsed.errors).toContain(
				'deploy.cron job "c" path must not contain whitespace or quote characters (it is shell-quoted into the cron command)',
			)
		}
	})

	it('accepts a path that carries a query string', () => {
		const parsed = validateCronJobs(
			[
				{
					name: 'c',
					schedule: '0 0 * * *',
					path: '/api/run?scope=all&force=1',
				},
			],
			SERVICES,
		)

		expect(parsed.ok).toBe(true)
	})

	it('rejects an unknown method', () => {
		const parsed = validateCronJobs(
			[{ name: 'c', schedule: '0 0 * * *', path: '/x', method: 'PUT' }],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
		expect(parsed.ok ? [] : parsed.errors).toContain(
			'deploy.cron job "c" method must be one of: GET, POST',
		)
	})

	it('rejects a service that is not a declared deploy service', () => {
		const parsed = validateCronJobs(
			[
				{
					name: 'c',
					schedule: '0 0 * * *',
					path: '/x',
					service: 'ghost',
				},
			],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
		expect(parsed.ok ? [] : parsed.errors).toContain(
			'deploy.cron job "c" service "ghost" must reference a declared [deploy.services.<name>]',
		)
	})

	it('rejects duplicate job names', () => {
		const parsed = validateCronJobs(
			[
				{ name: 'dup', schedule: '0 0 * * *', path: '/a' },
				{ name: 'dup', schedule: '0 1 * * *', path: '/b' },
			],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
		expect(parsed.ok ? [] : parsed.errors).toContain(
			'deploy.cron job "dup" is duplicated',
		)
	})

	it('rejects a non-kebab job name', () => {
		const parsed = validateCronJobs(
			[{ name: 'Clean_Up', schedule: '0 0 * * *', path: '/x' }],
			SERVICES,
		)

		expect(parsed.ok).toBe(false)
	})
})
