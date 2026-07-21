import { describe, expect, it, vi } from 'vitest'

import { postPrComment } from './pr-comment.ts'

import type { ExecResult, GhRunner } from './gh-runner.ts'

function ok(): ExecResult {
	return { exitCode: 0, stdout: '', stderr: '' }
}

function fail(exitCode: number, stderr: string): ExecResult {
	return { exitCode, stdout: '', stderr }
}

describe('postPrComment', () => {
	it('passes the body via stdin and targets the PR on the given repo', async () => {
		const runner = vi.fn<GhRunner>().mockResolvedValue(ok())

		await postPrComment(
			{ owner: 'acme', name: 'app' },
			'42',
			'### Terraform plan\n\n```\nPlan: 1\n```',
			runner,
		)

		expect(runner).toHaveBeenCalledWith(
			['pr', 'comment', '42', '--repo', 'acme/app', '--body-file', '-'],
			'### Terraform plan\n\n```\nPlan: 1\n```',
		)
	})

	it('throws with the gh stderr on non-zero exit', async () => {
		const runner = vi
			.fn<GhRunner>()
			.mockResolvedValue(fail(1, 'GraphQL: Resource not accessible'))

		await expect(
			postPrComment({ owner: 'acme', name: 'app' }, '7', 'body', runner),
		).rejects.toThrow(
			'gh pr comment 7 failed (exit 1): GraphQL: Resource not accessible',
		)
	})
})
