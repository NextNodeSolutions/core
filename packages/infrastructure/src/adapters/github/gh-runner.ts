import { execBounded } from '#/adapters/process/exec.ts'

import type { ExecResult } from '#/adapters/process/exec.ts'

const MS_PER_SECOND = 1_000

const GH_TIMEOUT_MS = 120_000

const GH_MAX_BUFFER_BYTES = 16_777_216

export interface GhRunner {
	(args: ReadonlyArray<string>, stdin?: string): Promise<ExecResult>
}

function timeoutMessage(args: ReadonlyArray<string>): string {
	return `gh ${args.join(' ')} timed out after ${String(GH_TIMEOUT_MS / MS_PER_SECOND)}s and was killed - a hung call usually means an unreachable GitHub API; retry the job`
}

// Without a body, stdin still closes at once, so gh never waits for input.
export const defaultGhRunner: GhRunner = (args, stdin) =>
	execBounded('gh', args, {
		env: process.env,
		stdin: stdin ?? '',
		maxBufferBytes: GH_MAX_BUFFER_BYTES,
		timeoutMs: GH_TIMEOUT_MS,
		timeoutMessage: timeoutMessage(args),
	})
