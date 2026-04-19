import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { R2Operations } from '../../r2/client.types.ts'

import {
	deleteState,
	EtagMismatchError,
	readState,
	writeState,
} from './read-write.ts'

function createMockR2(): R2Operations {
	return {
		get: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
		exists: vi.fn(),
		deleteByPrefix: vi.fn(),
	}
}

const createdState = {
	phase: 'created' as const,
	serverId: 123,
	publicIp: '1.2.3.4',
}

const provisionedState = {
	phase: 'provisioned' as const,
	serverId: 123,
	publicIp: '1.2.3.4',
	tailnetIp: '100.74.91.126',
}

const convergedState = {
	phase: 'converged' as const,
	serverId: 123,
	publicIp: '1.2.3.4',
	tailnetIp: '100.74.91.126',
	convergedAt: '2026-04-17T10:00:00.000Z',
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

	it('parses created phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify(createdState),
			etag: '"etag-1"',
		})

		const result = await readState(r2, 'acme-web')

		expect(result).toStrictEqual({ state: createdState, etag: '"etag-1"' })
	})

	it('parses provisioned phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify(provisionedState),
			etag: '"etag-1"',
		})

		const result = await readState(r2, 'acme-web')

		expect(result).toStrictEqual({
			state: provisionedState,
			etag: '"etag-1"',
		})
	})

	it('parses converged phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify(convergedState),
			etag: '"etag-1"',
		})

		const result = await readState(r2, 'acme-web')

		expect(result).toStrictEqual({
			state: convergedState,
			etag: '"etag-1"',
		})
	})

	it('throws on invalid JSON', async () => {
		vi.mocked(r2.get).mockResolvedValue({ body: 'not json', etag: '"e"' })

		await expect(readState(r2, 'acme-web')).rejects.toThrow()
	})

	it('throws on missing phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({
				serverId: 1,
				publicIp: '1.2.3.4',
				tailnetIp: '100.1.2.3',
			}),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/unknown or missing phase/,
		)
	})

	it('throws on unknown phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({
				phase: 'bogus',
				serverId: 1,
				publicIp: '1.2.3.4',
			}),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/unknown or missing phase "bogus"/,
		)
	})

	it('throws on missing serverId in created phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({ phase: 'created', publicIp: '1.2.3.4' }),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/missing serverId/,
		)
	})

	it('throws on missing publicIp in created phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({ phase: 'created', serverId: 1 }),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/missing publicIp/,
		)
	})

	it('throws on missing tailnetIp in provisioned phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({
				phase: 'provisioned',
				serverId: 1,
				publicIp: '1.2.3.4',
			}),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/missing tailnetIp/,
		)
	})

	it('throws on missing convergedAt in converged phase', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify({
				phase: 'converged',
				serverId: 1,
				publicIp: '1.2.3.4',
				tailnetIp: '100.1.2.3',
			}),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(
			/missing convergedAt/,
		)
	})

	it('throws on non-object state', async () => {
		vi.mocked(r2.get).mockResolvedValue({
			body: JSON.stringify('a string'),
			etag: '"e"',
		})

		await expect(readState(r2, 'acme-web')).rejects.toThrow(/not an object/)
	})
})

describe('writeState', () => {
	it('writes JSON to R2 and returns etag', async () => {
		vi.mocked(r2.put).mockResolvedValue('"new-etag"')

		const etag = await writeState(r2, 'acme-web', createdState)

		expect(etag).toBe('"new-etag"')
		expect(r2.put).toHaveBeenCalledWith(
			'hetzner/acme-web.json',
			JSON.stringify(createdState),
			undefined,
		)
	})

	it('passes ifMatch for conditional write', async () => {
		vi.mocked(r2.put).mockResolvedValue('"new-etag"')

		await writeState(r2, 'acme-web', provisionedState, '"old-etag"')

		expect(r2.put).toHaveBeenCalledWith(
			'hetzner/acme-web.json',
			JSON.stringify(provisionedState),
			'"old-etag"',
		)
	})

	it('retries on transient failure and succeeds', async () => {
		vi.mocked(r2.put)
			.mockRejectedValueOnce(new Error('network blip'))
			.mockResolvedValue('"ok"')

		const etag = await writeState(r2, 'acme-web', convergedState, '"stale"')

		expect(etag).toBe('"ok"')
		expect(r2.put).toHaveBeenCalledTimes(2)
	})

	it('throws after 3 transient retries', async () => {
		vi.mocked(r2.put).mockRejectedValue(new Error('network blip'))

		await expect(
			writeState(r2, 'acme-web', createdState, '"stale"'),
		).rejects.toThrow(/failed after 3 transient retries/)

		expect(r2.put).toHaveBeenCalledTimes(3)
	})

	it('throws EtagMismatchError immediately on 412 without retrying', async () => {
		const preconditionFailed = Object.assign(
			new Error('precondition failed'),
			{
				name: 'PreconditionFailed',
			},
		)
		vi.mocked(r2.put).mockRejectedValue(preconditionFailed)

		await expect(
			writeState(r2, 'acme-web', provisionedState, '"stale"'),
		).rejects.toBeInstanceOf(EtagMismatchError)

		expect(r2.put).toHaveBeenCalledTimes(1)
	})

	it('throws EtagMismatchError when $metadata.httpStatusCode is 412', async () => {
		const httpErr = Object.assign(new Error('precondition failed'), {
			$metadata: { httpStatusCode: 412 },
		})
		vi.mocked(r2.put).mockRejectedValue(httpErr)

		await expect(
			writeState(r2, 'acme-web', provisionedState, '"stale"'),
		).rejects.toBeInstanceOf(EtagMismatchError)

		expect(r2.put).toHaveBeenCalledTimes(1)
	})
})

describe('deleteState', () => {
	it('deletes the state key', async () => {
		vi.mocked(r2.delete).mockResolvedValue(undefined)

		await deleteState(r2, 'acme-web')

		expect(r2.delete).toHaveBeenCalledWith('hetzner/acme-web.json')
	})
})
