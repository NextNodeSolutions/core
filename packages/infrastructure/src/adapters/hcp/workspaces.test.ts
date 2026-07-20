import { httpError, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TERRAFORM_CLOUD_API_BASE, ensureHcpWorkspace } from './workspaces.ts'

const INPUT = {
	organization: 'nextnode',
	workspaceName: 'app-development',
	token: 'tf-tok',
}

const GET_URL = `${TERRAFORM_CLOUD_API_BASE}/organizations/nextnode/workspaces/app-development`
const CREATE_URL = `${TERRAFORM_CLOUD_API_BASE}/organizations/nextnode/workspaces`

function workspaceBody(executionMode: string): unknown {
	return {
		data: {
			type: 'workspaces',
			attributes: {
				name: 'app-development',
				'execution-mode': executionMode,
			},
		},
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('ensureHcpWorkspace', () => {
	it('returns a not-handled outcome when the workspace already exists', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(okJson(workspaceBody('local')))
		vi.stubGlobal('fetch', fetchMock)

		const outcome = await ensureHcpWorkspace(INPUT)
		expect(outcome).toEqual({
			handled: false,
			detail: 'existing "app-development"',
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			GET_URL,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer tf-tok',
					'Content-Type': 'application/vnd.api+json',
				}),
			}),
		)
	})

	it('creates the workspace in local execution mode when absent', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(httpError(404, 'not found'))
			.mockResolvedValueOnce(okJson(workspaceBody('local')))
		vi.stubGlobal('fetch', fetchMock)

		const outcome = await ensureHcpWorkspace(INPUT)
		expect(outcome).toEqual({
			handled: true,
			detail: 'created "app-development" (execution mode local)',
		})
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			CREATE_URL,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer tf-tok',
					'Content-Type': 'application/vnd.api+json',
				}),
				body: JSON.stringify({
					data: {
						type: 'workspaces',
						attributes: {
							name: 'app-development',
							'execution-mode': 'local',
						},
					},
				}),
			}),
		)
	})

	it('throws with the raw body on a non-404 GET error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(500, 'internal error')),
		)
		await expect(ensureHcpWorkspace(INPUT)).rejects.toThrow(
			'HCP Terraform API returned 500: internal error',
		)
	})

	it('throws an actionable error when an existing workspace is remote', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okJson(workspaceBody('remote'))),
		)
		await expect(ensureHcpWorkspace(INPUT)).rejects.toThrow(
			'has execution mode "remote", but state-only provisioning requires "local"',
		)
	})

	it('throws with the raw body when creation fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(httpError(404, 'not found'))
				.mockResolvedValueOnce(httpError(422, 'invalid attributes')),
		)
		await expect(ensureHcpWorkspace(INPUT)).rejects.toThrow(
			'HCP Terraform API returned 422: invalid attributes',
		)
	})
})
