import { spawnSync } from 'node:child_process'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

export interface ExecResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

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

export async function probeGh(runner: GhRunner): Promise<boolean> {
	try {
		const spawnResult = await runner(['--version'])
		return spawnResult.exitCode === 0
	} catch (error) {
		logger.warn(
			`gh CLI availability probe failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return false
	}
}
