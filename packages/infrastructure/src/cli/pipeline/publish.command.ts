import { spawnSync } from 'node:child_process'

import { getEnv, requireEnv } from '#/cli/env.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const DEFAULT_SR_OUTPUT = '/tmp/sr-output.txt'

export function publishCommand(): void {
	const packageDir = requireEnv('PACKAGE_DIR')
	const srOutputFile = getEnv('SR_OUTPUT_FILE') ?? DEFAULT_SR_OUTPUT

	const spawnResult = spawnSync(
		'bash',
		[
			'-c',
			'set -o pipefail; pnpm exec semantic-release 2>&1 | tee "$SR_OUTPUT_FILE"',
		],
		{
			cwd: packageDir,
			stdio: 'inherit',
			env: { ...process.env, SR_OUTPUT_FILE: srOutputFile },
		},
	)

	if (spawnResult.status === 0) {
		return
	}

	logger.error('semantic-release failed')
	process.exitCode = spawnResult.status ?? 1
}
