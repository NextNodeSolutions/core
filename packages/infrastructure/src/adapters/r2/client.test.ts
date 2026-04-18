import { NoSuchKey, S3Client } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { R2Client } from './client.ts'

const send = vi.fn()

const fakeS3 = new S3Client({ region: 'auto' })
fakeS3.send = send

const config = {
	endpoint: 'https://abc.r2.cloudflarestorage.com',
	accessKeyId: 'key',
	secretAccessKey: 'secret',
	bucket: 'nextnode-state',
} as const

let client: R2Client

beforeEach(() => {
	send.mockReset()
	client = new R2Client(config, fakeS3)
})

describe('get', () => {
	it('returns body and etag on success', async () => {
		send.mockResolvedValue({
			Body: { transformToString: () => Promise.resolve('{"id":1}') },
			ETag: '"abc123"',
		})

		const result = await client.get('hetzner/acme.json')

		expect(result).toStrictEqual({ body: '{"id":1}', etag: '"abc123"' })
	})

	it('returns null for missing key', async () => {
		send.mockRejectedValue(
			new NoSuchKey({ $metadata: {}, message: 'not found' }),
		)

		const result = await client.get('missing.json')

		expect(result).toBeNull()
	})

	it('throws on unexpected error', async () => {
		send.mockRejectedValue(new Error('network failure'))

		await expect(client.get('bad.json')).rejects.toThrow(
			/R2 get "bad.json"/,
		)
	})
})

describe('put', () => {
	it('returns etag on success', async () => {
		send.mockResolvedValue({ ETag: '"new-etag"' })

		const etag = await client.put('state.json', '{}')

		expect(etag).toBe('"new-etag"')
	})

	it('sends correct bucket and key', async () => {
		send.mockResolvedValue({ ETag: '"e"' })

		await client.put('hetzner/acme.json', '{"id":1}')

		const command = send.mock.lastCall?.[0]
		expect(command.input.Bucket).toBe('nextnode-state')
		expect(command.input.Key).toBe('hetzner/acme.json')
		expect(command.input.Body).toBe('{"id":1}')
	})
})

describe('delete', () => {
	it('sends delete command', async () => {
		send.mockResolvedValue({})

		await client.delete('old.json')

		const command = send.mock.lastCall?.[0]
		expect(command.input.Key).toBe('old.json')
	})
})

describe('deleteByPrefix', () => {
	it('returns 0 when the prefix is empty', async () => {
		send.mockResolvedValue({
			Contents: [],
			NextContinuationToken: undefined,
		})

		const count = await client.deleteByPrefix('my-project/')

		expect(count).toBe(0)
	})

	it('lists and deletes all objects under the prefix in one page', async () => {
		send.mockImplementation(async command => {
			const name: unknown = command.constructor.name
			if (name === 'ListObjectsV2Command') {
				return {
					Contents: [
						{ Key: 'my-project/a.json' },
						{ Key: 'my-project/b.json' },
					],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		const count = await client.deleteByPrefix('my-project/')

		expect(count).toBe(2)
		const calls = send.mock.calls.map(c => c[0].constructor.name)
		expect(calls).toContain('ListObjectsV2Command')
		expect(calls).toContain('DeleteObjectsCommand')
	})

	it('paginates through multiple list pages', async () => {
		let callIndex = 0
		send.mockImplementation(async command => {
			const name: unknown = command.constructor.name
			if (name === 'ListObjectsV2Command') {
				callIndex += 1
				if (callIndex === 1) {
					return {
						Contents: [{ Key: 'p/a.json' }],
						NextContinuationToken: 'token-2',
					}
				}
				return {
					Contents: [{ Key: 'p/b.json' }, { Key: 'p/c.json' }],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		const count = await client.deleteByPrefix('p/')

		expect(count).toBe(3)
	})

	it('skips objects without a Key', async () => {
		send.mockImplementation(async command => {
			const name: unknown = command.constructor.name
			if (name === 'ListObjectsV2Command') {
				return {
					Contents: [{ Key: 'p/a.json' }, { Key: undefined }],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		const count = await client.deleteByPrefix('p/')

		expect(count).toBe(1)
	})
})

describe('exists', () => {
	it('returns true when object exists', async () => {
		send.mockResolvedValue({})

		expect(await client.exists('state.json')).toBe(true)
	})

	it('returns false for NoSuchKey', async () => {
		send.mockRejectedValue(
			new NoSuchKey({ $metadata: {}, message: 'not found' }),
		)

		expect(await client.exists('missing.json')).toBe(false)
	})

	it('returns false on NotFound error name', async () => {
		const err = new Error('not found')
		err.name = 'NotFound'
		send.mockRejectedValue(err)

		expect(await client.exists('missing.json')).toBe(false)
	})
})
