import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	attachPagesDomain,
	createPagesProject,
	getPagesProject,
	listPagesDomains,
} from './cloudflare-pages.ts'

const TOKEN = 'cf-token-123'
const ACCOUNT = 'acct-abc'
const PROJECT = 'my-site'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

function notFound(): MockResponse {
	return {
		ok: false,
		status: 404,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve('Not found'),
	}
}

function httpError(status: number, body: string): MockResponse {
	return {
		ok: false,
		status,
		text: () => Promise.resolve(body),
		json: () => Promise.resolve({}),
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('getPagesProject', () => {
	it('returns the project when it exists', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { name: PROJECT, production_branch: 'main' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const project = await getPagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(project).toEqual({ name: PROJECT, productionBranch: 'main' })
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		)
	})

	it('returns null when the project does not exist (404)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound()))

		const project = await getPagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(project).toBeNull()
	})

	it('throws on non-404 HTTP errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(500, 'server down')),
		)

		await expect(getPagesProject(ACCOUNT, PROJECT, TOKEN)).rejects.toThrow(
			'Cloudflare API returned 500',
		)
	})

	it('throws when the API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: {},
					errors: [{ code: 10001, message: 'Invalid account' }],
				}),
			),
		)

		await expect(getPagesProject(ACCOUNT, PROJECT, TOKEN)).rejects.toThrow(
			'[10001] Invalid account',
		)
	})

	it('URL-encodes the project name', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { name: 'weird name', production_branch: 'main' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		await getPagesProject(ACCOUNT, 'weird name', TOKEN)

		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/weird%20name`,
			expect.any(Object),
		)
	})
})

describe('createPagesProject', () => {
	it('POSTs the payload and returns the created project', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { name: PROJECT, production_branch: 'main' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const project = await createPagesProject(
			ACCOUNT,
			PROJECT,
			'main',
			TOKEN,
		)

		expect(project).toEqual({ name: PROJECT, productionBranch: 'main' })
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					name: PROJECT,
					production_branch: 'main',
				}),
			}),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(
			createPagesProject(ACCOUNT, PROJECT, 'main', TOKEN),
		).rejects.toThrow('Cloudflare API returned 403')
	})

	it('throws when the API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: {},
					errors: [
						{ code: 8000007, message: 'Project already exists' },
					],
				}),
			),
		)

		await expect(
			createPagesProject(ACCOUNT, PROJECT, 'main', TOKEN),
		).rejects.toThrow('[8000007] Project already exists')
	})
})

describe('listPagesDomains', () => {
	it('returns the attached domains', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: [
					{ name: 'example.com', status: 'active' },
					{ name: 'www.example.com', status: 'pending' },
				],
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const domains = await listPagesDomains(ACCOUNT, PROJECT, TOKEN)

		expect(domains).toEqual([
			{ name: 'example.com' },
			{ name: 'www.example.com' },
		])
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		)
	})

	it('returns an empty list when no domains are attached', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					okJson({ success: true, result: [], errors: [] }),
				),
		)

		const domains = await listPagesDomains(ACCOUNT, PROJECT, TOKEN)

		expect(domains).toEqual([])
	})

	it('URL-encodes the project name', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				okJson({ success: true, result: [], errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		await listPagesDomains(ACCOUNT, 'weird name', TOKEN)

		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/weird%20name/domains`,
			expect.any(Object),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(500, 'server down')),
		)

		await expect(listPagesDomains(ACCOUNT, PROJECT, TOKEN)).rejects.toThrow(
			'Cloudflare API returned 500',
		)
	})

	it('throws when the API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: [],
					errors: [{ code: 10001, message: 'Invalid account' }],
				}),
			),
		)

		await expect(listPagesDomains(ACCOUNT, PROJECT, TOKEN)).rejects.toThrow(
			'[10001] Invalid account',
		)
	})
})

describe('attachPagesDomain', () => {
	it('POSTs the domain name and returns the attached domain', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { name: 'example.com', status: 'initializing' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const domain = await attachPagesDomain(
			ACCOUNT,
			PROJECT,
			'example.com',
			TOKEN,
		)

		expect(domain).toEqual({ name: 'example.com' })
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}/domains`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ name: 'example.com' }),
			}),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(
			attachPagesDomain(ACCOUNT, PROJECT, 'example.com', TOKEN),
		).rejects.toThrow('Cloudflare API returned 403')
	})

	it('throws when the API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: {},
					errors: [
						{ code: 8000001, message: 'Domain already exists' },
					],
				}),
			),
		)

		await expect(
			attachPagesDomain(ACCOUNT, PROJECT, 'example.com', TOKEN),
		).rejects.toThrow('[8000001] Domain already exists')
	})
})
