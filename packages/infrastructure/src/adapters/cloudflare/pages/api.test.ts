import { afterEach, describe, expect, it, vi } from 'vitest'

import { httpError, notFound, okJson } from '@/test-fetch.ts'

import {
	attachPagesDomain,
	createPagesProject,
	deletePagesProject,
	getPagesProject,
	listPagesDomains,
} from './api.ts'

const TOKEN = 'cf-token-123'
const ACCOUNT = 'acct-abc'
const PROJECT = 'my-site'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('getPagesProject', () => {
	it('returns the project when it exists', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: {
					name: PROJECT,
					production_branch: 'main',
					subdomain: `${PROJECT}.pages.dev`,
				},
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const project = await getPagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(project).toEqual({
			name: PROJECT,
			productionBranch: 'main',
			subdomain: `${PROJECT}.pages.dev`,
		})
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		)
	})

	it('returns the auto-suffixed subdomain when the project name was already taken', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: {
						name: PROJECT,
						production_branch: 'main',
						subdomain: `${PROJECT}-6zu.pages.dev`,
					},
					errors: [],
				}),
			),
		)

		const project = await getPagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(project?.subdomain).toBe(`${PROJECT}-6zu.pages.dev`)
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
				result: {
					name: 'weird name',
					production_branch: 'main',
					subdomain: 'weird-name.pages.dev',
				},
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

	it('throws when the API response omits subdomain', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: { name: PROJECT, production_branch: 'main' },
					errors: [],
				}),
			),
		)

		await expect(getPagesProject(ACCOUNT, PROJECT, TOKEN)).rejects.toThrow(
			'subdomain missing',
		)
	})
})

describe('createPagesProject', () => {
	it('POSTs the payload and returns the created project', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: {
					name: PROJECT,
					production_branch: 'main',
					subdomain: `${PROJECT}.pages.dev`,
				},
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

		expect(project).toEqual({
			name: PROJECT,
			productionBranch: 'main',
			subdomain: `${PROJECT}.pages.dev`,
		})
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

describe('deletePagesProject', () => {
	it('sends DELETE request and returns true on success', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve(null),
			text: () => Promise.resolve(''),
		})
		vi.stubGlobal('fetch', fetchMock)

		const deleted = await deletePagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(deleted).toBe(true)
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`,
			expect.objectContaining({ method: 'DELETE' }),
		)
	})

	it('returns false when the project is already gone (404)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound()))

		const deleted = await deletePagesProject(ACCOUNT, PROJECT, TOKEN)

		expect(deleted).toBe(false)
	})

	it('throws on non-404 HTTP errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(
			deletePagesProject(ACCOUNT, PROJECT, TOKEN),
		).rejects.toThrow('Cloudflare API returned 403')
	})

	it('URL-encodes the project name', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve(null),
			text: () => Promise.resolve(''),
		})
		vi.stubGlobal('fetch', fetchMock)

		await deletePagesProject(ACCOUNT, 'weird name', TOKEN)

		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/weird%20name`,
			expect.any(Object),
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
