import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeOutput, writeSummary } from '#/adapters/github/output.ts'
import { readSemanticReleaseOutput } from '#/adapters/github/semantic-release.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import {
	buildSummary,
	parseSemanticReleaseOutput,
} from '#/domain/pipeline/publish-result.ts'

import type { PublishResult } from '#/domain/pipeline/publish-result.ts'

const DEFAULT_SR_OUTPUT = '/tmp/sr-output.txt'

export function publishResultCommand(): void {
	const outputPath = getEnv('SR_OUTPUT_FILE') ?? DEFAULT_SR_OUTPUT
	const projectFilter = requireEnv('PROJECT_FILTER')

	let content: string
	try {
		content = readSemanticReleaseOutput(outputPath)
	} catch {
		logger.error(`Semantic-release output not found: ${outputPath}`)
		const failure: PublishResult = { status: 'failure' }
		writeOutput('status', 'failure')
		writeSummary(buildSummary(failure, projectFilter))
		process.exitCode = 1
		return
	}

	const release = parseSemanticReleaseOutput(content)

	writeOutput('status', release.status)
	if (release.version) {
		writeOutput('version', release.version)
	}
	writeSummary(buildSummary(release, projectFilter))

	logger.info(
		`Publish result: ${release.status}${release.version ? ` v${release.version}` : ''}`,
	)

	if (release.status === 'failure') {
		process.exitCode = 1
	}
}
