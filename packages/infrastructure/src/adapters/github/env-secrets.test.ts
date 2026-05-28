import { describe, expect, it, vi } from 'vitest'

import { createEnvSecretsAdapter } from './env-secrets.ts'

import type { ExecResult, GhRunner } from './gh-runner.ts'

function ok(stdout = '', stderr = ''): ExecResult {
	return { exitCode: 0, stdout, stderr }
}

function fail(exitCode: number, stderr: string): ExecResult {
	return { exitCode, stdout: '', stderr }
}

describe('createEnvSecretsAdapter', () => {
	it('passes the secret value via stdin and scopes to repo + environment', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(ok())
		const adapter = createEnvSecretsAdapter(runner)

		await adapter.setRepoEnvSecret(
			'POSTGRES_PASSWORD',
			'my-secret',
			'NextNodeSolutions',
			'core',
			'production',
		)

		expect(runner).toHaveBeenCalledWith(
			[
				'secret',
				'set',
				'POSTGRES_PASSWORD',
				'--repo',
				'NextNodeSolutions/core',
				'--env',
				'production',
			],
			'my-secret',
		)
	})

	it('throws on non-zero exit when setting an env-secret', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(fail(1, 'no perms'))
		const adapter = createEnvSecretsAdapter(runner)

		await expect(
			adapter.setRepoEnvSecret(
				'NAME',
				'val',
				'owner',
				'repo',
				'production',
			),
		).rejects.toThrow(
			'gh secret set "NAME" --env "production" failed (exit 1): no perms',
		)
	})

	it('ghAvailable returns false when runner throws', async () => {
		const runner = vi.fn<GhRunner>().mockRejectedValue(new Error('ENOENT'))
		const adapter = createEnvSecretsAdapter(runner)
		await expect(adapter.ghAvailable()).resolves.toBe(false)
	})

	it('ghAvailable returns true on successful version call', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(ok('gh version 2.x'))
		const adapter = createEnvSecretsAdapter(runner)
		await expect(adapter.ghAvailable()).resolves.toBe(true)
	})
})
