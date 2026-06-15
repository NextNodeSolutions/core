/**
 * Pure GitHub project logic for the projects screen. The adapter fetches the
 * org repos + each repo's latest workflow run and hands them here; this maps
 * them into the card model, derives deploy status and gates the actions.
 * Nothing is inferred that the API does not actually report.
 */

const SHORT_SHA_LENGTH = 7

export interface GithubRepo {
	readonly name: string
	readonly fullName: string
	readonly isPrivate: boolean
	readonly description: string | null
	readonly defaultBranch: string
	readonly htmlUrl: string
	readonly archived: boolean
	readonly pushedAt: string | null
}

export interface GithubRun {
	readonly status: string
	readonly conclusion: string | null
	readonly createdAt: string
	readonly headSha: string
	readonly htmlUrl: string
}

export type ProjectDeployStatus =
	| 'ready'
	| 'building'
	| 'error'
	| 'queued'
	| 'archived'
	| 'unknown'

export interface GithubProjectSummary {
	readonly slug: string
	readonly name: string
	readonly repo: string
	readonly isPrivate: boolean
	readonly description: string | null
	readonly defaultBranch: string
	readonly htmlUrl: string
	readonly deployStatus: ProjectDeployStatus
	readonly lastCommit: string | null
	readonly lastDeployAt: string | null
	readonly pendingApproval: boolean
	readonly vps: string | null
}

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out'])

const runDeployStatus = (run: GithubRun): ProjectDeployStatus => {
	if (run.status === 'waiting' || run.status === 'queued') return 'queued'
	if (run.status === 'in_progress') return 'building'
	if (run.status !== 'completed') return 'unknown'
	if (run.conclusion === 'success') return 'ready'
	if (run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion)) {
		return 'error'
	}
	return 'unknown'
}

const resolveDeployStatus = (
	repo: GithubRepo,
	run: GithubRun | null,
): ProjectDeployStatus => {
	if (repo.archived) return 'archived'
	if (run === null) return 'unknown'
	return runDeployStatus(run)
}

/** First server whose name equals the repo or carries it as a `repo-` prefix. */
export const matchProjectVps = (
	repoName: string,
	serverNames: ReadonlyArray<string>,
): string | null =>
	serverNames.find(
		name => name === repoName || name.startsWith(`${repoName}-`),
	) ?? null

export const summarizeGithubProject = (
	repo: GithubRepo,
	run: GithubRun | null,
	serverNames: ReadonlyArray<string>,
): GithubProjectSummary => ({
	slug: repo.name,
	name: repo.name,
	repo: repo.fullName,
	isPrivate: repo.isPrivate,
	description: repo.description,
	defaultBranch: repo.defaultBranch,
	htmlUrl: repo.htmlUrl,
	deployStatus: resolveDeployStatus(repo, run),
	lastCommit: run === null ? null : run.headSha.slice(0, SHORT_SHA_LENGTH),
	lastDeployAt: run?.createdAt ?? null,
	pendingApproval: run?.status === 'waiting',
	vps: matchProjectVps(repo.name, serverNames),
})

export const canDeploy = (summary: GithubProjectSummary): boolean =>
	summary.deployStatus !== 'archived'

export const canApprove = (summary: GithubProjectSummary): boolean =>
	summary.pendingApproval

export const canTeardown = (summary: GithubProjectSummary): boolean =>
	summary.vps !== null
