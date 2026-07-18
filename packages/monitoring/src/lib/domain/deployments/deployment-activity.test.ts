import { describe, expect, it } from 'vitest'

import {
	activityKey,
	mergeActivity,
	selectRecentActivity,
} from '@/lib/domain/deployments/deployment-activity.ts'

import type { RecentDeployment } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

const pagesEntry = (id: string, createdAt: string): RecentDeployment => ({
	projectName: 'alpha',
	deployment: {
		id,
		shortId: id.slice(0, 8),
		environment: 'production',
		url: null,
		branch: 'main',
		commitHash: 'abc1234def',
		commitMessage: `pages ${id}`,
		author: null,
		trigger: null,
		createdAt,
		modifiedAt: createdAt,
		status: 'success',
		stageName: null,
		isSkipped: false,
		aliases: [],
	},
})

const vpsRun = (id: string, createdAt: string): VpsDeployRun => ({
	id,
	repoName: 'core',
	workflowName: 'Monitoring',
	title: `vps ${id}`,
	branch: 'main',
	headSha: 'fedcba9876543',
	htmlUrl: `https://github.com/x/y/actions/runs/${id}`,
	createdAt,
	status: 'completed',
	conclusion: 'success',
	environment: 'production',
})

describe('selectRecentActivity', () => {
	it('interleaves both sources newest-first and caps to the limit', () => {
		const merged = mergeActivity(
			[
				pagesEntry('p-old', '2026-07-01T10:00:00Z'),
				pagesEntry('p-new', '2026-07-18T10:00:00Z'),
			],
			[vpsRun('r-mid', '2026-07-10T10:00:00Z')],
		)
		const selected = selectRecentActivity(merged, 'all', 2)
		expect(selected.map(activityKey)).toEqual(['pages:p-new', 'vps:r-mid'])
	})

	it('filters by source', () => {
		const merged = mergeActivity(
			[pagesEntry('p1', '2026-07-18T10:00:00Z')],
			[vpsRun('r1', '2026-07-18T11:00:00Z')],
		)
		expect(
			selectRecentActivity(merged, 'vps', 10).map(activityKey),
		).toEqual(['vps:r1'])
		expect(
			selectRecentActivity(merged, 'pages', 10).map(activityKey),
		).toEqual(['pages:p1'])
	})

	it('returns an empty list from empty sources', () => {
		expect(selectRecentActivity(mergeActivity([], []), 'all', 5)).toEqual(
			[],
		)
	})
})
