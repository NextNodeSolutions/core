import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SshSession } from '@/adapters/hetzner/ssh/session.types.ts'

import { waitForSsh } from './wait-for-ssh.ts'

function createMockSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		execWithStdin: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

vi.mock(import('@/adapters/hetzner/ssh/session.ts'), async importOriginal => {
	const actual = await importOriginal()
	return {
		...actual,
		createSshSession: vi.fn(async () => createMockSession()),
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

describe('waitForSsh', () => {
	it('resolves on the first attempt', async () => {
		await expect(
			waitForSsh({ host: 'h', privateKey: 'k' }),
		).resolves.toEqual({ hostKeyFingerprint: 'test-fingerprint' })
	})

	it('retries on transient failures', async () => {
		const { createSshSession: mocked } =
			await import('@/adapters/hetzner/ssh/session.ts')
		vi.mocked(mocked)
			.mockRejectedValueOnce(new Error('Connection refused'))
			.mockRejectedValueOnce(new Error('Connection refused'))
			.mockResolvedValueOnce(createMockSession())

		await expect(
			waitForSsh({ host: 'h', privateKey: 'k' }),
		).resolves.toEqual({ hostKeyFingerprint: 'test-fingerprint' })
	})

	it('throws after max attempts', async () => {
		const { createSshSession: mocked } =
			await import('@/adapters/hetzner/ssh/session.ts')
		vi.mocked(mocked).mockRejectedValue(new Error('Connection refused'))

		await expect(
			waitForSsh({ host: 'h', privateKey: 'k' }),
		).rejects.toThrow('not reachable after 36 attempts')
	})

	it('closes the probe session on success', async () => {
		const session = createMockSession()
		const { createSshSession: mocked } =
			await import('@/adapters/hetzner/ssh/session.ts')
		vi.mocked(mocked).mockResolvedValueOnce(session)

		await waitForSsh({ host: 'h', privateKey: 'k' })

		expect(session.close).toHaveBeenCalled()
	})
})
