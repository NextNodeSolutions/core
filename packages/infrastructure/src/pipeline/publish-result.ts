import { readFileSync } from 'node:fs'

import { logger } from '@nextnode-solutions/logger'

import { writeOutput, writeSummary } from '../github/output.js'

type PublishStatus = 'published' | 'no-release' | 'failure'

interface PublishResult {
	readonly status: PublishStatus
	readonly version?: string
}

const VERSION_PATTERN = /Published release (\d+\.\d+\.\d+)/
const NO_RELEASE_PATTERN = /no new version|There are no relevant changes/i

export function parseSemanticReleaseOutput(content: string): PublishResult {
	const versionMatch = VERSION_PATTERN.exec(content)
	if (versionMatch?.[1]) {
		return { status: 'published', version: versionMatch[1] }
	}

	if (NO_RELEASE_PATTERN.test(content)) {
		return { status: 'no-release' }
	}

	return { status: 'failure' }
}

function buildSummary(result: PublishResult, projectFilter: string): string {
	switch (result.status) {
		case 'published':
			return `### :white_check_mark: Published ${projectFilter} v${result.version}`
		case 'no-release':
			return `### :fast_forward: No new release for ${projectFilter}`
		case 'failure':
			return `### :x: Publish failed for ${projectFilter}`
	}
}

export function publishResult(): void {
	const outputPath = process.env['SR_OUTPUT_FILE'] ?? '/tmp/sr-output.txt'
	const projectFilter = process.env['PROJECT_FILTER']
	if (!projectFilter) {
		throw new Error('PROJECT_FILTER env var is required')
	}

	let content: string
	try {
		content = readFileSync(outputPath, 'utf-8')
	} catch {
		logger.error(`Semantic-release output not found: ${outputPath}`)
		writeOutput('status', 'failure')
		writeSummary(buildSummary({ status: 'failure' }, projectFilter))
		return
	}

	const result = parseSemanticReleaseOutput(content)

	writeOutput('status', result.status)
	if (result.version) {
		writeOutput('version', result.version)
	}
	writeSummary(buildSummary(result, projectFilter))

	logger.info(
		`Publish result: ${result.status}${result.version ? ` v${result.version}` : ''}`,
	)
}
