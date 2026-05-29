export interface PublishFailureAnalysis {
	readonly canRecover: boolean
	readonly publishedVersion?: string
}

const NPM_PUBLISHED_PATTERN =
	/\[@semantic-release\/npm\].*Published .*?(\d+\.\d+\.\d+(?:-[\w.]+)?)/
const GIT_PUSH_REJECTED_PATTERN =
	/non-fast-forward|Updates were rejected|\[rejected\]/i

export function analyzePublishFailure(output: string): PublishFailureAnalysis {
	const npmMatch = NPM_PUBLISHED_PATTERN.exec(output)
	const publishedVersion = npmMatch?.[1]
	const gitPushFailed = GIT_PUSH_REJECTED_PATTERN.test(output)

	if (publishedVersion && gitPushFailed) {
		return {
			canRecover: true,
			publishedVersion,
		}
	}

	return { canRecover: false }
}
