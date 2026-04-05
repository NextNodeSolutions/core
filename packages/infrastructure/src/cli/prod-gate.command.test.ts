import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prodGateCommand } from './prod-gate.command.ts'

describe('prodGateCommand', () => {
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

	it('passes when dev workflow run succeeded', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						total_count: 2,
						workflow_runs: [
							{
								path: '.github/workflows/deploy-dev.yml',
								status: 'completed',
								conclusion: 'success',
								html_url:
									'https://github.com/org/repo/actions/runs/1',
							},
							{
								path: '.github/workflows/deploy-prod.yml',
								status: 'completed',
								conclusion: 'success',
								html_url:
									'https://github.com/org/repo/actions/runs/2',
							},
						],
					}),
			}),
		)

		await expect(prodGateCommand()).resolves.toBeUndefined()
	})

	it('throws when no dev run found', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({ total_count: 0, workflow_runs: [] }),
			}),
		)

		await expect(prodGateCommand()).rejects.toThrow(
			'No dev pipeline run found for abc123',
		)
	})

	it('throws when dev run failed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						total_count: 1,
						workflow_runs: [
							{
								path: '.github/workflows/deploy-dev.yml',
								status: 'completed',
								conclusion: 'failure',
								html_url:
									'https://github.com/org/repo/actions/runs/1',
							},
						],
					}),
			}),
		)

		await expect(prodGateCommand()).rejects.toThrow(
			'Dev pipeline has not passed: completed/failure',
		)
	})

	it('throws when dev run is still in progress', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						total_count: 1,
						workflow_runs: [
							{
								path: '.github/workflows/deploy-dev.yml',
								status: 'in_progress',
								conclusion: null,
								html_url:
									'https://github.com/org/repo/actions/runs/1',
							},
						],
					}),
			}),
		)

		await expect(prodGateCommand()).rejects.toThrow(
			'Dev pipeline has not passed: in_progress/null',
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

		await expect(prodGateCommand()).rejects.toThrow(
			'GitHub API returned 403',
		)
	})

	it('throws when GITHUB_REPOSITORY is not set', async () => {
		delete process.env['GITHUB_REPOSITORY']

		await expect(prodGateCommand()).rejects.toThrow(
			'GITHUB_REPOSITORY env var',
		)
	})
})
