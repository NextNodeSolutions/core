import { describe, expect, it, vi } from 'vitest'

import type { ExecResult, GhRunner } from './org-secrets.ts'
import { createOrgSecretsAdapter } from './org-secrets.ts'

function ok(stdout = '', stderr = ''): ExecResult {
	return { exitCode: 0, stdout, stderr }
}

function fail(exitCode: number, stderr: string): ExecResult {
	return { exitCode, stdout: '', stderr }
}

describe('createOrgSecretsAdapter', () => {
	it('passes the secret value via stdin', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(ok())
		const adapter = createOrgSecretsAdapter(runner)

		await adapter.setOrgSecret('R2_ACCESS_KEY_ID', 'my-id', 'NextNodeOrg')

		expect(runner).toHaveBeenCalledWith(
			['secret', 'set', 'R2_ACCESS_KEY_ID', '--org', 'NextNodeOrg'],
			'my-id',
		)
	})

	it('throws on non-zero exit when setting a secret', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(fail(1, 'no perms'))
		const adapter = createOrgSecretsAdapter(runner)

		await expect(
			adapter.setOrgSecret('NAME', 'val', 'org'),
		).rejects.toThrow('gh secret set "NAME" failed (exit 1): no perms')
	})

	it('ghAvailable returns false when runner throws', async () => {
		const runner = vi.fn<GhRunner>().mockRejectedValue(new Error('ENOENT'))
		const adapter = createOrgSecretsAdapter(runner)
		await expect(adapter.ghAvailable()).resolves.toBe(false)
	})

	it('ghAvailable returns true on successful version call', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(ok('gh version 2.x'))
		const adapter = createOrgSecretsAdapter(runner)
		await expect(adapter.ghAvailable()).resolves.toBe(true)
	})
})
