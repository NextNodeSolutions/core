import { spawnSync } from 'node:child_process'

import type { ExecResult } from '#/adapters/process/exec.ts'

export interface GhRunner {
	(args: ReadonlyArray<string>, stdin?: string): Promise<ExecResult>
}

export const defaultGhRunner: GhRunner = async (args, stdin) => {
	const spawnResult = spawnSync('gh', [...args], {
		input: stdin,
		encoding: 'utf8',
	})
	if (spawnResult.error) throw spawnResult.error
	return {
		exitCode: spawnResult.status ?? 0,
		stdout: spawnResult.stdout,
		stderr: spawnResult.stderr,
	}
}
