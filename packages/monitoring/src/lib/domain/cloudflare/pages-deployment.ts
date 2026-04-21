export type CloudflarePagesDeploymentStatus =
	| 'success'
	| 'failure'
	| 'canceled'
	| 'skipped'
	| 'active'
	| 'idle'
	| 'unknown'

export interface CloudflarePagesDeployment {
	readonly id: string
	readonly shortId: string
	readonly environment: 'production' | 'preview'
	readonly url: string | null
	readonly branch: string | null
	readonly commitHash: string | null
	readonly commitMessage: string | null
	readonly author: string | null
	readonly trigger: string | null
	readonly createdAt: string
	readonly modifiedAt: string
	readonly status: CloudflarePagesDeploymentStatus
	readonly stageName: string | null
	readonly isSkipped: boolean
	readonly aliases: ReadonlyArray<string>
}
