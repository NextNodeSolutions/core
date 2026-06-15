import { describe, expect, it } from 'vitest'

import {
	canApprove,
	canDeploy,
	canTeardown,
	matchProjectVps,
	summarizeGithubProject,
} from './github-project.ts'

import type { GithubRepo, GithubRun } from './github-project.ts'

const repo = (over: Partial<GithubRepo>): GithubRepo => ({
	name: 'stylot',
	fullName: 'NextNodeSolutions/stylot',
	isPrivate: true,
	description: 'Stylot app',
	defaultBranch: 'main',
	htmlUrl: 'https://github.com/NextNodeSolutions/stylot',
	archived: false,
	pushedAt: '2026-06-13T10:00:00Z',
	...over,
})

const run = (over: Partial<GithubRun>): GithubRun => ({
	status: 'completed',
	conclusion: 'success',
	createdAt: '2026-06-13T09:00:00Z',
	headSha: 'abcdef1234567890',
	htmlUrl: 'https://github.com/NextNodeSolutions/stylot/actions/runs/1',
	...over,
})

describe('summarizeGithubProject deploy status', () => {
	it('is ready for a successful completed run', () => {
		expect(summarizeGithubProject(repo({}), run({}), []).deployStatus).toBe(
			'ready',
		)
	})

	it('is error for a failed run', () => {
		expect(
			summarizeGithubProject(repo({}), run({ conclusion: 'failure' }), [])
				.deployStatus,
		).toBe('error')
	})

	it('is error for a timed-out run', () => {
		expect(
			summarizeGithubProject(
				repo({}),
				run({ conclusion: 'timed_out' }),
				[],
			).deployStatus,
		).toBe('error')
	})

	it('is unknown for a neutral completed run', () => {
		expect(
			summarizeGithubProject(repo({}), run({ conclusion: 'neutral' }), [])
				.deployStatus,
		).toBe('unknown')
	})

	it('is building while in progress and queued while waiting', () => {
		expect(
			summarizeGithubProject(repo({}), run({ status: 'in_progress' }), [])
				.deployStatus,
		).toBe('building')
		expect(
			summarizeGithubProject(repo({}), run({ status: 'waiting' }), [])
				.deployStatus,
		).toBe('queued')
	})

	it('is archived regardless of the run when the repo is archived', () => {
		expect(
			summarizeGithubProject(repo({ archived: true }), run({}), [])
				.deployStatus,
		).toBe('archived')
	})

	it('is unknown when there is no run', () => {
		expect(summarizeGithubProject(repo({}), null, []).deployStatus).toBe(
			'unknown',
		)
	})
})

describe('summarizeGithubProject fields', () => {
	it('shortens the commit, surfaces the last deploy and the pending approval', () => {
		const summary = summarizeGithubProject(
			repo({}),
			run({ status: 'waiting', headSha: 'abcdef1234567890' }),
			['stylot-prod'],
		)
		expect(summary.lastCommit).toBe('abcdef1')
		expect(summary.lastDeployAt).toBe('2026-06-13T09:00:00Z')
		expect(summary.pendingApproval).toBe(true)
		expect(summary.vps).toBe('stylot-prod')
		expect(summary.repo).toBe('NextNodeSolutions/stylot')
	})

	it('leaves commit/deploy null and approval false with no run', () => {
		const summary = summarizeGithubProject(repo({}), null, [])
		expect(summary.lastCommit).toBeNull()
		expect(summary.lastDeployAt).toBeNull()
		expect(summary.pendingApproval).toBe(false)
		expect(summary.vps).toBeNull()
	})
})

describe('matchProjectVps', () => {
	it('matches an exact or prefixed server name, else null', () => {
		expect(matchProjectVps('stylot', ['stylot-prod', 'monitoring'])).toBe(
			'stylot-prod',
		)
		expect(matchProjectVps('monitoring', ['monitoring'])).toBe('monitoring')
		expect(matchProjectVps('mizraj', ['stylot-prod'])).toBeNull()
	})
})

describe('action gating', () => {
	const base = summarizeGithubProject(repo({}), run({}), ['stylot-prod'])

	it('allows deploy unless archived', () => {
		expect(canDeploy(base)).toBe(true)
		expect(
			canDeploy(
				summarizeGithubProject(repo({ archived: true }), run({}), []),
			),
		).toBe(false)
	})

	it('allows approve only when pending and teardown only with a vps', () => {
		expect(canApprove(base)).toBe(false)
		expect(
			canApprove(
				summarizeGithubProject(
					repo({}),
					run({ status: 'waiting' }),
					[],
				),
			),
		).toBe(true)
		expect(canTeardown(base)).toBe(true)
		expect(canTeardown(summarizeGithubProject(repo({}), run({}), []))).toBe(
			false,
		)
	})
})
