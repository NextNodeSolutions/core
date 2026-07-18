/**
 * Pure GitHub project logic for the projects screen. The adapter fetches the
 * org repos + each repo's latest workflow run and hands them here; this maps
 * them into the card model, derives deploy status and gates the actions.
 * Nothing is inferred that the API does not actually report.
 */

import { runPhase, shortSha } from '@/lib/domain/github/run-status.ts'

import type { RunPhase } from '@/lib/domain/github/run-status.ts'

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

// `pending` (pending/requested statuses) has never surfaced as queued on this
// screen; it stays 'unknown' so the projection is a pure refactor.
const RUN_PHASE_PROJECT = {
	queued: 'queued',
	pending: 'unknown',
	running: 'building',
	succeeded: 'ready',
	failed: 'error',
	unknown: 'unknown',
} satisfies Record<RunPhase, ProjectDeployStatus>

const runDeployStatus = (run: GithubRun): ProjectDeployStatus =>
	RUN_PHASE_PROJECT[runPhase(run)]

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
	lastCommit: run === null ? null : shortSha(run.headSha),
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
