import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { R2Operations } from '../r2/client.types.ts'

import { deleteState, readState, writeState } from './hcloud-state.ts'

function createMockR2(): R2Operations {
	return {
		get: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
		exists: vi.fn(),
	}
}

const validState = {
	serverId: 123,
	publicIp: '1.2.3.4',
	tailnetIp: '100.74.91.126',
}

let r2: R2Operations

beforeEach(() => {
	r2 = createMockR2()
})

describe('readState', () => {
	it('returns null for missing state', async () => {
		vi.mocked(r2.get).mockResolvedValue(null)

		const result = await readState(r2, 'acme-web')

		expect(result).toBeNull()
		expect(r2.get).toHaveBeenCalledWith('hetzner/acme-web.json')
	})

	it('returns parsed state with etag', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify(validState),
			etag: '"etag-1"',
		})

		const result = await readState(r2, 'acme-web')

		expect(result).toStrictEqual({ state: validState, etag: '"etag-1"' })
	})

	it('throws on invalid JSON', async () => {
		vi.mocked(r2.get).mockResolvedValue({ body: 'not json', etag: '"e"' })

		await expect(readState(r2, 'acme-web')).rejects.toThrow()
	})

	it('throws on missing serverId', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({
				publicIp: '1.2.3.4',
				tailnetIp: '100.1.2.3',
			}),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/missing serverId/,
		)
	})
})

describe('writeState', () => {
	it('writes JSON to R2 and returns etag', async () => {
		vi.mocked(r2.put).mockResolvedValue('"new-etag"')

		const etag = await writeState(r2, 'acme-web', validState)

		expect(etag).toBe('"new-etag"')
		expect(r2.put).toHaveBeenCalledWith(
			'hetzner/acme-web.json',
			JSON.stringify(validState),
			undefined,
		)
	})

	it('passes ifMatch for conditional write', async () => {
		vi.mocked(r2.put).mockResolvedValue('"new-etag"')

		await writeState(r2, 'acme-web', validState, '"old-etag"')

		expect(r2.put).toHaveBeenCalledWith(
			'hetzner/acme-web.json',
			JSON.stringify(validState),
			'"old-etag"',
		)
	})

	it('retries on failure and succeeds', async () => {
		vi.mocked(r2.put)
			.mockRejectedValueOnce(new Error('ETag mismatch'))
			.mockResolvedValue('"ok"')

		const etag = await writeState(r2, 'acme-web', validState, '"stale"')

		expect(etag).toBe('"ok"')
		expect(r2.put).toHaveBeenCalledTimes(2)
	})

	it('throws after 3 failed attempts', async () => {
		vi.mocked(r2.put).mockRejectedValue(new Error('ETag mismatch'))

		await expect(
			writeState(r2, 'acme-web', validState, '"stale"'),
		).rejects.toThrow(/State lock contention.*3 attempts/)

		expect(r2.put).toHaveBeenCalledTimes(3)
	})
})

describe('deleteState', () => {
	it('deletes the state key', async () => {
		vi.mocked(r2.delete).mockResolvedValue(undefined)

		await deleteState(r2, 'acme-web')

		expect(r2.delete).toHaveBeenCalledWith('hetzner/acme-web.json')
	})
})
