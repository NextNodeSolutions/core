import { describe, expect, it, vi } from 'vitest'

import { wranglerDelete } from './runner.ts'

import type { ExecResult, WranglerRunner } from './runner.ts'

function runnerReturning(execResult: ExecResult): ReturnType<typeof vi.fn> {
	return vi.fn<WranglerRunner>().mockResolvedValue(execResult)
}

describe('wranglerDelete', () => {
	it('calls `wrangler delete --name <name> --force`', async () => {
		const runner = runnerReturning({ exitCode: 0, stdout: '', stderr: '' })

		await wranglerDelete('my-worker-production-web', runner)

		expect(runner).toHaveBeenCalledWith([
			'delete',
			'--name',
			'my-worker-production-web',
			'--force',
		])
	})

	it('returns handled on a successful delete', async () => {
		const runner = runnerReturning({ exitCode: 0, stdout: '', stderr: '' })

		await expect(wranglerDelete('worker-a', runner)).resolves.toEqual({
			handled: true,
			detail: 'deleted "worker-a"',
		})
	})

	it('maps a script_not_found error to "already gone"', async () => {
		const runner = runnerReturning({
			exitCode: 1,
			stdout: '',
			stderr: 'workers.api.error.script_not_found',
		})

		await expect(wranglerDelete('worker-a', runner)).resolves.toEqual({
			handled: false,
			detail: 'already gone "worker-a"',
		})
	})

	it('maps the [code: 10007] fingerprint to "already gone"', async () => {
		const runner = runnerReturning({
			exitCode: 1,
			stdout: '',
			stderr: 'A request to the Cloudflare API failed. [code: 10007]',
		})

		await expect(wranglerDelete('worker-a', runner)).resolves.toEqual({
			handled: false,
			detail: 'already gone "worker-a"',
		})
	})

	it('throws the wrangler stderr verbatim on any other failure', async () => {
		const runner = runnerReturning({
			exitCode: 1,
			stdout: '',
			stderr: 'Authentication error [code: 10000]',
		})

		await expect(wranglerDelete('worker-a', runner)).rejects.toThrow(
			/wrangler delete --name worker-a failed \(exit 1\):\nAuthentication error \[code: 10000\]/,
		)
	})
})
