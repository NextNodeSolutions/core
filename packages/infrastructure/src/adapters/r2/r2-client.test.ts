import { NoSuchKey, S3Client } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { R2Client } from './r2-client.ts'

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
