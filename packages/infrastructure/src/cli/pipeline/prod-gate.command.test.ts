import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prodGateCommand } from './prod-gate.command.ts'

describe('prodGateCommand', () => {
	beforeEach(() => {
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/core')
		vi.stubEnv('GITHUB_SHA', 'abc123')
		vi.stubEnv('GH_TOKEN', 'fake-token')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
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

	it('uses custom DEV_WORKFLOW_FILE when set', async () => {
		vi.stubEnv('DEV_WORKFLOW_FILE', 'landing-dev.yml')
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						total_count: 1,
						workflow_runs: [
							{
								path: '.github/workflows/landing-dev.yml',
								status: 'completed',
								conclusion: 'success',
								html_url:
									'https://github.com/org/repo/actions/runs/1',
							},
						],
					}),
			}),
		)

		await expect(prodGateCommand()).resolves.toBeUndefined()
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
		vi.stubEnv('GITHUB_REPOSITORY', undefined)

		await expect(prodGateCommand()).rejects.toThrow(
			'GITHUB_REPOSITORY env var',
		)
	})
})
