import { httpError, notFound, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The create POST is the 2nd call (GET 404 -> POST -> poll GET); `lastBody`
// would read the trailing poll GET, which carries no body.
function createBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
	const body = fetchMock.mock.calls[1]?.[1]?.body
	if (typeof body !== 'string') throw new Error('expected a create body')
	return JSON.parse(body)
}

import { ensurePlanetscaleDatabase, PLANETSCALE_API_BASE } from './databases.ts'

const INPUT = {
	organization: 'nextnode',
	database: 'app-production-planetscale',
	serviceTokenId: 'tok-id',
	serviceToken: 'tok-secret',
	clusterSize: 'PS_10',
	region: 'us-east',
}

const GET_URL = `${PLANETSCALE_API_BASE}/organizations/nextnode/databases/app-production-planetscale`
const CREATE_URL = `${PLANETSCALE_API_BASE}/organizations/nextnode/databases`

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('ensurePlanetscaleDatabase', () => {
	it('returns a not-handled outcome when the database already exists and is ready', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okJson({ ready: true }))
		vi.stubGlobal('fetch', fetchMock)

		const outcome = await ensurePlanetscaleDatabase(INPUT)

		expect(outcome).toEqual({
			handled: false,
			detail: 'existing "app-production-planetscale"',
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			GET_URL,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'tok-id:tok-secret',
				}),
			}),
		)
	})

	it('creates the database on 404, then polls until ready', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(notFound())
			.mockResolvedValueOnce(okJson({ id: 'db-1' }))
			.mockResolvedValueOnce(okJson({ ready: true }))
		vi.stubGlobal('fetch', fetchMock)

		const outcome = await ensurePlanetscaleDatabase(INPUT)

		expect(outcome).toEqual({
			handled: true,
			detail: 'created "app-production-planetscale"',
		})
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			CREATE_URL,
			expect.objectContaining({ method: 'POST' }),
		)
		expect(createBody(fetchMock)).toEqual({
			name: 'app-production-planetscale',
			kind: 'postgresql',
			cluster_size: 'PS_10',
			region: 'us-east',
		})
	})

	it('omits cluster_size and region from the create body when unset', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(notFound())
			.mockResolvedValueOnce(okJson({ id: 'db-1' }))
			.mockResolvedValueOnce(okJson({ ready: true }))
		vi.stubGlobal('fetch', fetchMock)

		await ensurePlanetscaleDatabase({
			organization: 'nextnode',
			database: 'app-production-planetscale',
			serviceTokenId: 'tok-id',
			serviceToken: 'tok-secret',
		})

		expect(createBody(fetchMock)).toEqual({
			name: 'app-production-planetscale',
			kind: 'postgresql',
		})
	})

	it('throws on a non-404 GET error', async () => {
		const fetchMock = vi.fn().mockResolvedValue(httpError(500, 'boom'))
		vi.stubGlobal('fetch', fetchMock)

		await expect(ensurePlanetscaleDatabase(INPUT)).rejects.toThrow(
			/PlanetScale API returned 500/,
		)
	})
})
