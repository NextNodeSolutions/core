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
	const result = spawnSync('gh', [...args], {
		input: stdin,
		encoding: 'utf8',
	})
	if (result.error) throw result.error
	return {
		exitCode: result.status ?? 0,
		stdout: result.stdout,
		stderr: result.stderr,
	}
}

export async function probeGh(runner: GhRunner): Promise<boolean> {
	try {
		const result = await runner(['--version'])
		return result.exitCode === 0
	} catch (error) {
		logger.warn(
			`gh CLI availability probe failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return false
	}
}
