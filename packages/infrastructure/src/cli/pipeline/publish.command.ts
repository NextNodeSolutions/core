import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

import { recoverReleasePush } from '#/adapters/git/release-push.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { analyzePublishFailure } from '#/domain/pipeline/publish-recovery.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const DEFAULT_SR_OUTPUT = '/tmp/sr-output.txt'
const DEFAULT_BRANCH = 'main'

export function publishCommand(): void {
	const packageDir = requireEnv('PACKAGE_DIR')
	const repoRoot = requireEnv('GITHUB_WORKSPACE')
	const srOutputFile = getEnv('SR_OUTPUT_FILE') ?? DEFAULT_SR_OUTPUT
	const branch = getEnv('PUBLISH_BRANCH') ?? DEFAULT_BRANCH

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

	const output = readFileSync(srOutputFile, 'utf-8')
	const analysis = analyzePublishFailure(output)

	if (!analysis.canRecover) {
		logger.error('semantic-release failed without a recoverable cause')
		process.exitCode = spawnResult.status ?? 1
		return
	}

	logger.warn(
		`npm published ${analysis.publishedVersion} but git push was rejected - rebasing and re-pushing`,
	)
	recoverReleasePush({ repoRoot, branch })
	appendFileSync(
		srOutputFile,
		`\n[recovery] Published release ${analysis.publishedVersion}\n`,
	)
	logger.info(`recovered: ${analysis.publishedVersion} fully released`)
}
