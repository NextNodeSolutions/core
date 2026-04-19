import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { waitForServerRunning } from './wait-for-server-running.ts'

vi.mock(import('../api/client.ts'), async importOriginal => {
	const actual = await importOriginal()
	return {
		...actual,
		describeServer: vi.fn(async () => ({
			id: 42,
			name: 'x',
			status: 'running',
			public_net: { ipv4: { ip: '1.2.3.4' } },
		})),
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

describe('waitForServerRunning', () => {
	it('resolves on the first attempt when the server is already running', async () => {
		await expect(waitForServerRunning('t', 42)).resolves.toBeUndefined()
	})

	it('retries until the server reports running', async () => {
		const { describeServer: mocked } = await import('../api/client.ts')
		vi.mocked(mocked)
			.mockResolvedValueOnce({
				id: 42,
				name: 'x',
				status: 'initializing',
				public_net: { ipv4: { ip: '1.2.3.4' } },
			})
			.mockResolvedValueOnce({
				id: 42,
				name: 'x',
				status: 'running',
				public_net: { ipv4: { ip: '1.2.3.4' } },
			})

		await expect(waitForServerRunning('t', 42)).resolves.toBeUndefined()
	})

	it('throws after max attempts', async () => {
		const { describeServer: mocked } = await import('../api/client.ts')
		vi.mocked(mocked).mockResolvedValue({
			id: 42,
			name: 'x',
			status: 'initializing',
			public_net: { ipv4: { ip: '1.2.3.4' } },
		})

		await expect(waitForServerRunning('t', 42)).rejects.toThrow(
			'Server 42 startup: timed out after 24 attempts',
		)
	})

	it('propagates describeServer errors', async () => {
		const { describeServer: mocked } = await import('../api/client.ts')
		vi.mocked(mocked).mockRejectedValueOnce(new Error('Hetzner API: 500'))

		await expect(waitForServerRunning('t', 42)).rejects.toThrow(
			'Hetzner API: 500',
		)
	})
})
