import { afterEach, describe, expect, it, vi } from 'vitest'

import { GithubMalformedResponseError } from '@/lib/adapters/github/client.ts'
import { listDeployWorkflows } from '@/lib/adapters/github/deploy-workflows.ts'

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})

const base64 = (text: string): string =>
	Buffer.from(text, 'utf8').toString('base64')

const CALLER_YAML = [
	'name: Monitoring',
	'jobs:',
	'    pipeline:',
	'        uses: ./.github/workflows/deploy.yml',
].join('\n')

const STATIC_CALLER_YAML = [
	'name: Landing',
	'jobs:',
	'    pipeline:',
	'        uses: NextNodeSolutions/core/.github/workflows/deploy-static.yml@main',
].join('\n')

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('listDeployWorkflows', () => {
	it('keeps only active workflows whose YAML calls the reusable deploy.yml', async () => {
		const fetchStub = vi.fn((url: string) => {
			if (url.includes('/actions/workflows')) {
				return Promise.resolve(
					jsonResponse({
						workflows: [
							{
								id: 1,
								name: 'Monitoring',
								path: '.github/workflows/monitoring.yml',
								state: 'active',
							},
							{
								id: 2,
								name: 'Landing',
								path: '.github/workflows/landing.yml',
								state: 'active',
							},
							{
								id: 3,
								name: 'Old',
								path: '.github/workflows/old.yml',
								state: 'disabled_manually',
							},
						],
					}),
				)
			}
			if (url.includes('/contents/.github/workflows/monitoring.yml')) {
				return Promise.resolve(
					jsonResponse({
						content: base64(CALLER_YAML),
						encoding: 'base64',
					}),
				)
			}
			if (url.includes('/contents/.github/workflows/landing.yml')) {
				return Promise.resolve(
					jsonResponse({
						content: base64(STATIC_CALLER_YAML),
						encoding: 'base64',
					}),
				)
			}
			return Promise.resolve(jsonResponse({ message: 'unexpected' }, 500))
		})
		vi.stubGlobal('fetch', fetchStub)

		const workflows = await listDeployWorkflows(
			'token-dw',
			'org/repo-mixed',
		)
		expect(workflows).toEqual([
			{
				id: 1,
				name: 'Monitoring',
				path: '.github/workflows/monitoring.yml',
			},
		])
		// The disabled workflow's file is never fetched.
		expect(
			fetchStub.mock.calls.some(([url]) => url.includes('old.yml')),
		).toBe(false)
	})

	it('skips a workflow whose file 404s (stale listing), keeping the rest', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((url: string) => {
				if (url.includes('/actions/workflows')) {
					return Promise.resolve(
						jsonResponse({
							workflows: [
								{
									id: 7,
									name: 'Ghost',
									path: '.github/workflows/ghost.yml',
									state: 'active',
								},
							],
						}),
					)
				}
				return Promise.resolve(
					jsonResponse({ message: 'Not Found' }, 404),
				)
			}),
		)

		await expect(
			listDeployWorkflows('token-dw', 'org/repo-stale'),
		).resolves.toEqual([])
	})

	it('throws when the 200 workflows payload lacks the workflows array', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(jsonResponse({ message: 'incident' }))),
		)

		await expect(
			listDeployWorkflows('token-dw', 'org/repo-malformed'),
		).rejects.toBeInstanceOf(GithubMalformedResponseError)
	})
})
