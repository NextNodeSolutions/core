import { describe, expect, it } from 'vitest'

import { activityRowView } from '@/lib/domain/deployments/activity-view.ts'
import { deploymentSelectionHref } from '@/lib/domain/deployments/deployment-routes.ts'

import type { RecentDeployment } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { ActivityEntry } from '@/lib/domain/deployments/deployment-activity.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

const deployment = (
	overrides: Partial<RecentDeployment['deployment']> = {},
): RecentDeployment['deployment'] => ({
	id: 'deploy-1',
	shortId: 'deploy-1',
	environment: 'production',
	url: null,
	branch: 'main',
	commitHash: 'abc1234def',
	commitMessage: 'feat: ship',
	author: null,
	trigger: null,
	createdAt: '2026-07-18T10:00:00Z',
	modifiedAt: '2026-07-18T10:05:00Z',
	status: 'success',
	stageName: null,
	isSkipped: false,
	aliases: [],
	...overrides,
})

const run = (overrides: Partial<VpsDeployRun> = {}): VpsDeployRun => ({
	id: '42',
	repoName: 'core',
	workflowName: 'Monitoring',
	title: 'fix: probe',
	branch: 'main',
	headSha: 'fedcba9876543',
	htmlUrl: 'https://github.com/x/core/actions/runs/42',
	createdAt: '2026-07-18T09:00:00Z',
	status: 'completed',
	conclusion: 'success',
	environment: 'production',
	...overrides,
})

describe('activityRowView', () => {
	it('builds a pages row with a drawer-opening deployment target', () => {
		const entry: ActivityEntry = {
			kind: 'pages',
			projectName: 'alpha',
			deployment: deployment(),
		}
		const view = activityRowView(entry)
		expect(view).toMatchObject({
			key: 'pages:deploy-1',
			source: 'pages',
			display: 'ready',
			title: 'feat: ship',
			branch: 'main',
			commit: 'abc1234',
			contextLabel: 'alpha',
			environment: 'production',
			target: {
				kind: 'deployment',
				projectName: 'alpha',
				deploymentId: 'deploy-1',
			},
		})
		expect(view.createdAtMs).toBe(Date.parse('2026-07-18T10:00:00Z'))
	})

	it('falls back to shortId for a pages row without message or hash', () => {
		const entry: ActivityEntry = {
			kind: 'pages',
			projectName: 'alpha',
			deployment: deployment({
				commitMessage: null,
				commitHash: null,
				branch: null,
			}),
		}
		const view = activityRowView(entry)
		expect(view.title).toBe('deploy-1')
		expect(view.commit).toBe('deploy-1')
		expect(view.branch).toBe('-')
	})

	it('builds a vps row with an external target', () => {
		const entry: ActivityEntry = { kind: 'vps', run: run() }
		const view = activityRowView(entry)
		expect(view).toMatchObject({
			key: 'vps:42',
			source: 'vps',
			display: 'ready',
			title: 'fix: probe',
			commit: 'fedcba9',
			contextLabel: 'core',
			target: {
				kind: 'external',
				href: 'https://github.com/x/core/actions/runs/42',
			},
		})
	})

	it('falls back to the workflow name for an untitled vps run', () => {
		const entry: ActivityEntry = { kind: 'vps', run: run({ title: '' }) }
		expect(activityRowView(entry).title).toBe('Monitoring')
	})
})

describe('deploymentSelectionHref', () => {
	it('URL-encodes both segments', () => {
		expect(deploymentSelectionHref('my app', 'id/1')).toBe(
			'/deployments?project=my%20app&sel=id%2F1',
		)
	})
})
