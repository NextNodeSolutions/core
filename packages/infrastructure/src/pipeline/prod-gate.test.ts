import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { evaluateDevRuns, prodGate } from './prod-gate.js'

describe('evaluateDevRuns', () => {
	it('counts all passing dev runs', () => {
		const runs = [
			{
				name: 'app-dev / Lint',
				status: 'completed',
				conclusion: 'success',
			},
			{
				name: 'app-dev / Test',
				status: 'completed',
				conclusion: 'success',
			},
		]

		const result = evaluateDevRuns(runs)

		expect(result).toEqual({ total: 2, passed: 2, failed: [] })
	})

	it('identifies failed dev runs', () => {
		const failedRun = {
			name: 'app-dev / Test',
			status: 'completed',
			conclusion: 'failure',
		}
		const runs = [
			{
				name: 'app-dev / Lint',
				status: 'completed',
				conclusion: 'success',
			},
			failedRun,
		]

		const result = evaluateDevRuns(runs)

		expect(result.total).toBe(2)
		expect(result.passed).toBe(1)
		expect(result.failed).toEqual([failedRun])
	})

	it('identifies in-progress runs as not passed', () => {
		const pendingRun = {
			name: 'app-dev / Lint',
			status: 'in_progress',
			conclusion: null,
		}
		const runs = [pendingRun]

		const result = evaluateDevRuns(runs)

		expect(result.total).toBe(1)
		expect(result.passed).toBe(0)
		expect(result.failed).toEqual([pendingRun])
	})

	it('filters out non-dev runs', () => {
		const runs = [
			{
				name: 'app-dev / Lint',
				status: 'completed',
				conclusion: 'success',
			},
			{
				name: 'app-prod / Deploy',
				status: 'completed',
				conclusion: 'success',
			},
			{
				name: 'quality / Build',
				status: 'completed',
				conclusion: 'success',
			},
		]

		const result = evaluateDevRuns(runs)

		expect(result.total).toBe(1)
		expect(result.passed).toBe(1)
	})

	it('returns zero counts when no dev runs exist', () => {
		const runs = [
			{
				name: 'app-prod / Deploy',
				status: 'completed',
				conclusion: 'success',
			},
		]

		const result = evaluateDevRuns(runs)

		expect(result).toEqual({ total: 0, passed: 0, failed: [] })
	})
})

describe('prodGate', () => {
	const savedEnv: Record<string, string | undefined> = {}

	beforeEach(() => {
		savedEnv['GITHUB_REPOSITORY'] = process.env['GITHUB_REPOSITORY']
		savedEnv['GITHUB_SHA'] = process.env['GITHUB_SHA']
		savedEnv['GH_TOKEN'] = process.env['GH_TOKEN']

		process.env['GITHUB_REPOSITORY'] = 'NextNodeSolutions/core'
		process.env['GITHUB_SHA'] = 'abc123'
		process.env['GH_TOKEN'] = 'fake-token'
	})

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
		vi.restoreAllMocks()
	})

	it('passes when all dev runs succeeded', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						check_runs: [
							{
								name: 'app-dev / Lint',
								status: 'completed',
								conclusion: 'success',
							},
							{
								name: 'app-dev / Test',
								status: 'completed',
								conclusion: 'success',
							},
						],
					}),
			}),
		)

		await expect(prodGate()).resolves.toBeUndefined()
	})

	it('throws when no dev runs found', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ check_runs: [] }),
			}),
		)

		await expect(prodGate()).rejects.toThrow(
			'No dev pipeline runs found for abc123',
		)
	})

	it('throws when some dev runs failed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						check_runs: [
							{
								name: 'app-dev / Lint',
								status: 'completed',
								conclusion: 'success',
							},
							{
								name: 'app-dev / Test',
								status: 'completed',
								conclusion: 'failure',
							},
						],
					}),
			}),
		)

		await expect(prodGate()).rejects.toThrow(
			'Dev pipeline has not fully passed (1/2 checks succeeded)',
		)
	})

	it('throws when GitHub API returns an error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				text: () => Promise.resolve('Forbidden'),
			}),
		)

		await expect(prodGate()).rejects.toThrow('GitHub API returned 403')
	})

	it('throws when GITHUB_REPOSITORY is not set', async () => {
		delete process.env['GITHUB_REPOSITORY']

		await expect(prodGate()).rejects.toThrow('GITHUB_REPOSITORY env var')
	})
})
