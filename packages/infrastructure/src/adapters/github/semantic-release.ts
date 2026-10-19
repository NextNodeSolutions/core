import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface SemanticReleaseRun {
	readonly packageDir: string
	readonly outputFile: string
}

export function runSemanticRelease({
	packageDir,
	outputFile,
}: SemanticReleaseRun): number {
	const spawnResult = spawnSync(
		'bash',
		[
			'-c',
			'set -o pipefail; pnpm exec semantic-release 2>&1 | tee "$SR_OUTPUT_FILE"',
		],
		{
			cwd: packageDir,
			stdio: 'inherit',
			env: { ...process.env, SR_OUTPUT_FILE: outputFile },
		},
	)
	return spawnResult.status ?? 1
}

export function readSemanticReleaseOutput(path: string): string {
	return readFileSync(path, 'utf-8')
}
