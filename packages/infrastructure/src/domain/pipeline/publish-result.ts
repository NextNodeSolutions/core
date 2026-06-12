export type PublishStatus = 'published' | 'no-release' | 'failure'

export interface PublishResult {
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

export function buildSummary(
	publishResult: PublishResult,
	projectFilter: string,
): string {
	if (publishResult.status === 'published') {
		return `### :white_check_mark: Published ${projectFilter} v${publishResult.version}`
	}
	if (publishResult.status === 'no-release') {
		return `### :fast_forward: No new release for ${projectFilter}`
	}
	return `### :x: Publish failed for ${projectFilter}`
}
