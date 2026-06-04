import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(() => Promise.resolve()),
}))

import { okJson } from '#/test-fetch.ts'

import { awaitR2DomainActive } from './await-domain-active.ts'

import type { MockResponse } from '#/test-fetch.ts'

const INPUT = {
	token: 'tok',
	accountId: 'acct',
	bucketName: 'myapp-production-assets',
	domain: 'assets.cdn.example.com',
}

function statusResponse(ssl: string): MockResponse {
	return okJson({
		success: true,
		result: { domain: INPUT.domain, status: { ownership: 'active', ssl } },
		errors: [],
	})
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('awaitR2DomainActive', () => {
	it('resolves on the first poll when ssl is already active', async () => {
		const fetchMock = vi.fn().mockResolvedValue(statusResponse('active'))
		vi.stubGlobal('fetch', fetchMock)

		await awaitR2DomainActive(INPUT)

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('keeps polling until ssl becomes active', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(statusResponse('initializing'))
			.mockResolvedValueOnce(statusResponse('pending'))
			.mockResolvedValueOnce(statusResponse('active'))
		vi.stubGlobal('fetch', fetchMock)

		await awaitR2DomainActive(INPUT)

		expect(fetchMock).toHaveBeenCalledTimes(3)
	})

	it('throws when the domain never becomes active within the budget', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(statusResponse('initializing')),
		)

		await expect(awaitR2DomainActive(INPUT)).rejects.toThrow(
			/did not become active/,
		)
	})
})
