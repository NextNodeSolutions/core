import { runSemanticRelease } from '#/adapters/github/semantic-release.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const DEFAULT_SR_OUTPUT = '/tmp/sr-output.txt'

export function publishCommand(): void {
	const exitCode = runSemanticRelease({
		packageDir: requireEnv('PACKAGE_DIR'),
		outputFile: getEnv('SR_OUTPUT_FILE') ?? DEFAULT_SR_OUTPUT,
	})

	if (exitCode === 0) {
		return
	}

	logger.error('semantic-release failed')
	process.exitCode = exitCode
}
