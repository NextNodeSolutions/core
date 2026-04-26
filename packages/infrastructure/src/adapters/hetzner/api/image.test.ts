import { httpError, lastCall, noContent, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteImage, findImagesByLabels } from './image.ts'

const TEST_TOKEN = 'hcloud-test-token'

afterEach(() => {
	vi.unstubAllGlobals()
})

const imagePayload = {
	images: [
		{
			id: 501,
			description: 'nextnode-golden-abc123',
			created: '2026-04-15T10:00:00+00:00',
			status: 'available',
			labels: {
				managed_by: 'nextnode-golden-image',
				infra_fingerprint: 'abc123',
			},
		},
		{
			id: 502,
			description: 'nextnode-golden-def456',
			created: '2026-04-10T10:00:00+00:00',
			status: 'available',
			labels: {
				managed_by: 'nextnode-golden-image',
				infra_fingerprint: 'def456',
			},
		},
	],
}

describe('findImagesByLabels', () => {
	it('sends label_selector query and returns parsed images', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(imagePayload))
		vi.stubGlobal('fetch', mock)

		const result = await findImagesByLabels(TEST_TOKEN, {
			managed_by: 'nextnode-golden-image',
		})

		expect(result).toHaveLength(2)
		expect(result[0]!.id).toBe(501)
		expect(result[0]!.description).toBe('nextnode-golden-abc123')
		expect(result[0]!.labels.managed_by).toBe('nextnode-golden-image')
		expect(result[1]!.id).toBe(502)

		const [url] = lastCall(mock)
		expect(url).toContain('/images?type=snapshot&label_selector=')
		expect(url).toContain('managed_by%3Dnextnode-golden-image')
	})

	it('returns empty array when no images match', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okJson({ images: [] })),
		)

		const result = await findImagesByLabels(TEST_TOKEN, {
			managed_by: 'nonexistent',
		})

		expect(result).toHaveLength(0)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(401, 'unauthorized')),
		)

		await expect(
			findImagesByLabels(TEST_TOKEN, { managed_by: 'x' }),
		).rejects.toThrow(/list images.*401.*unauthorized/)
	})

	it('throws on missing images array in response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okJson({ unexpected: true })),
		)

		await expect(
			findImagesByLabels(TEST_TOKEN, { managed_by: 'x' }),
		).rejects.toThrow(/missing `images` array/)
	})
})

describe('deleteImage', () => {
	it('sends DELETE request to correct URL', async () => {
		const mock = vi.fn().mockResolvedValue(noContent())
		vi.stubGlobal('fetch', mock)

		await deleteImage(TEST_TOKEN, 501)

		const [url, init] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/images/501')
		expect(init.method).toBe('DELETE')
	})

	it('throws on error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(deleteImage(TEST_TOKEN, 501)).rejects.toThrow(
			/delete image 501.*403/,
		)
	})
})
