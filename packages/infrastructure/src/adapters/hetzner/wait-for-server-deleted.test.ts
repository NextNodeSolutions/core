import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HcloudServerResponse } from './api/server.ts'
import { waitForServerDeleted } from './wait-for-server-deleted.ts'

vi.mock(import('./api/client.ts'), async importOriginal => {
	const actual = await importOriginal()
	return {
		...actual,
		findServerById: vi.fn(async () => null),
	}
})

vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(async () => undefined),
}))

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

const serverFixture = (
	status: 'deleting' | 'running',
): HcloudServerResponse => ({
	id: 42,
	name: 'x',
	status,
	public_net: { ipv4: { ip: '1.2.3.4' } },
})

describe('waitForServerDeleted', () => {
	it('resolves immediately when the server is already gone', async () => {
		await expect(waitForServerDeleted('t', 42)).resolves.toBeUndefined()
	})

	it('polls until the server returns 404', async () => {
		const { findServerById: mocked } = await import('./api/client.ts')
		vi.mocked(mocked)
			.mockResolvedValueOnce(serverFixture('deleting'))
			.mockResolvedValueOnce(serverFixture('deleting'))
			.mockResolvedValueOnce(null)

		await expect(waitForServerDeleted('t', 42)).resolves.toBeUndefined()
	})

	it('throws after max attempts when the server persists', async () => {
		const { findServerById: mocked } = await import('./api/client.ts')
		vi.mocked(mocked).mockResolvedValue(serverFixture('running'))

		await expect(waitForServerDeleted('t', 42)).rejects.toThrow(
			'still present after 24 attempts',
		)
	})

	it('propagates findServerById errors', async () => {
		const { findServerById: mocked } = await import('./api/client.ts')
		vi.mocked(mocked).mockRejectedValueOnce(new Error('Hetzner API: 500'))

		await expect(waitForServerDeleted('t', 42)).rejects.toThrow(
			'Hetzner API: 500',
		)
	})
})
