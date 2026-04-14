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
	result: PublishResult,
	projectFilter: string,
): string {
	switch (result.status) {
		case 'published':
			return `### :white_check_mark: Published ${projectFilter} v${result.version}`
		case 'no-release':
			return `### :fast_forward: No new release for ${projectFilter}`
		case 'failure':
			return `### :x: Publish failed for ${projectFilter}`
	}
}
