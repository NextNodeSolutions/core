import { describe, expect, it } from 'vitest'

import {
	deploymentDisplayStatus,
	deploymentPipelineSteps,
	selectRecentDeployments,
	summarizeProject,
} from './deployment-summary.ts'

import type {
	CloudflarePagesDeployment,
	CloudflarePagesDeploymentEnvironment,
	CloudflarePagesDeploymentStatus,
} from './pages-deployment.ts'

const dep = (
	over: Partial<CloudflarePagesDeployment>,
): CloudflarePagesDeployment => ({
	id: 'id',
	shortId: 'id',
	environment: 'production',
	url: null,
	branch: 'main',
	commitHash: null,
	commitMessage: null,
	author: null,
	trigger: null,
	createdAt: '2026-06-13T10:00:00Z',
	modifiedAt: '2026-06-13T10:00:00Z',
	status: 'success',
	stageName: null,
	isSkipped: false,
	aliases: [],
	...over,
})

const at = (
	iso: string,
	environment: CloudflarePagesDeploymentEnvironment,
	status: CloudflarePagesDeploymentStatus,
): CloudflarePagesDeployment =>
	dep({ id: iso, createdAt: iso, environment, status })

describe('deploymentDisplayStatus', () => {
	it('collapses Cloudflare statuses to the four display kinds', () => {
		expect(deploymentDisplayStatus('success')).toBe('ready')
		expect(deploymentDisplayStatus('active')).toBe('building')
		expect(deploymentDisplayStatus('failure')).toBe('error')
		expect(deploymentDisplayStatus('canceled')).toBe('idle')
		expect(deploymentDisplayStatus('idle')).toBe('idle')
	})
})

describe('summarizeProject', () => {
	// newest first, as Cloudflare returns them
	const deployments = [
		at('2026-06-13T12:00:00Z', 'production', 'success'),
		at('2026-06-13T11:00:00Z', 'preview', 'failure'),
		at('2026-06-13T10:00:00Z', 'production', 'failure'),
		at('2026-06-13T09:00:00Z', 'preview', 'success'),
	]
	const summary = summarizeProject(deployments)

	it('counts deployments per environment', () => {
		expect(summary.prodCount).toBe(2)
		expect(summary.previewCount).toBe(2)
	})

	it('takes the latest successful production deployment as current', () => {
		expect(summary.current?.id).toBe('2026-06-13T12:00:00Z')
	})

	it('skips a more recent non-success head to the canonical prod success', () => {
		// Head is a failed preview (newest), so `current` must NOT fall back to
		// deployments[0]; it must resolve to the older successful production.
		const withFailingHead = [
			at('2026-06-13T13:00:00Z', 'preview', 'failure'),
			at('2026-06-13T12:30:00Z', 'production', 'active'),
			at('2026-06-13T11:00:00Z', 'production', 'success'),
			at('2026-06-13T10:00:00Z', 'preview', 'success'),
		]
		const skipped = summarizeProject(withFailingHead)
		expect(skipped.current?.id).toBe('2026-06-13T11:00:00Z')
		expect(skipped.last?.id).toBe('2026-06-13T13:00:00Z')
	})

	it('falls back to the head when no production deployment ever succeeded', () => {
		const noProdSuccess = [
			at('2026-06-13T13:00:00Z', 'preview', 'failure'),
			at('2026-06-13T12:00:00Z', 'production', 'failure'),
		]
		expect(summarizeProject(noProdSuccess).current?.id).toBe(
			'2026-06-13T13:00:00Z',
		)
	})

	it('computes the success rate over finished deployments only', () => {
		// 4 finished (2 success, 2 failure) → 50%
		expect(summary.successRate).toBe(50)
		expect(summary.last?.id).toBe('2026-06-13T12:00:00Z')
		expect(summary.lastStatuses).toEqual([
			'ready',
			'error',
			'error',
			'ready',
		])
	})

	it('reports a null success rate when nothing has finished', () => {
		expect(
			summarizeProject([at('t', 'production', 'active')]).successRate,
		).toBeNull()
		expect(summarizeProject([]).successRate).toBeNull()
	})
})

describe('deploymentPipelineSteps', () => {
	it('marks a successful deployment as fully done', () => {
		const steps = deploymentPipelineSteps('success')
		expect(steps.at(-1)).toEqual({ label: 'Ready', state: 'done' })
		expect(steps.every(step => step.state === 'done')).toBe(true)
	})

	it('shows the build step active while building', () => {
		const steps = deploymentPipelineSteps('active')
		expect(steps[2]).toEqual({ label: 'Building', state: 'active' })
		expect(steps[3]?.state).toBe('pending')
	})

	it('fails the final step on error', () => {
		const steps = deploymentPipelineSteps('failure')
		expect(steps.at(-1)).toEqual({ label: 'Failed', state: 'failed' })
	})
})

describe('selectRecentDeployments', () => {
	it('merges across projects, newest first, capped to the limit', () => {
		const entries = [
			{
				projectName: 'a',
				deployment: at('2026-06-13T09:00:00Z', 'production', 'success'),
			},
			{
				projectName: 'b',
				deployment: at('2026-06-13T12:00:00Z', 'preview', 'success'),
			},
			{
				projectName: 'a',
				deployment: at('2026-06-13T11:00:00Z', 'production', 'failure'),
			},
		]
		const recent = selectRecentDeployments(entries, 2)
		expect(recent.map(entry => entry.deployment.id)).toEqual([
			'2026-06-13T12:00:00Z',
			'2026-06-13T11:00:00Z',
		])
		expect(recent[0]?.projectName).toBe('b')
	})
})
