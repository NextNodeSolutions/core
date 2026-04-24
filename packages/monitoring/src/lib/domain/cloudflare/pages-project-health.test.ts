import { describe, expect, it } from 'vitest'

import type {
	CloudflarePagesDeployment,
	CloudflarePagesDeploymentEnvironment,
	CloudflarePagesDeploymentStatus,
} from '@/lib/domain/cloudflare/pages-deployment.ts'
import { computeProjectHealth } from '@/lib/domain/cloudflare/pages-project-health.ts'

const deployment = (
	id: string,
	status: CloudflarePagesDeploymentStatus,
	environment: CloudflarePagesDeploymentEnvironment = 'production',
): CloudflarePagesDeployment => ({
	id,
	shortId: id.slice(0, 7),
	environment,
	url: null,
	branch: null,
	commitHash: null,
	commitMessage: null,
	author: null,
	trigger: null,
	createdAt: '2026-04-22T00:00:00Z',
	modifiedAt: '2026-04-22T00:00:00Z',
	status,
	stageName: null,
	isSkipped: false,
	aliases: [],
})

describe('computeProjectHealth', () => {
	it('returns unknown when no production deployment exists', () => {
		expect(computeProjectHealth([])).toEqual({
			status: 'unknown',
			label: 'Not deployed',
		})
	})

	it('ignores preview-only deployments when judging production health', () => {
		expect(
			computeProjectHealth([deployment('a', 'success', 'preview')]),
		).toEqual({ status: 'unknown', label: 'Not deployed' })
	})

	it('returns down when production has only ever failed', () => {
		expect(
			computeProjectHealth([
				deployment('a', 'failure'),
				deployment('b', 'failure'),
			]),
		).toEqual({ status: 'down', label: 'Never built' })
	})

	it('returns degraded with "Deploying" when the latest production build is active', () => {
		expect(
			computeProjectHealth([
				deployment('a', 'active'),
				deployment('b', 'success'),
			]),
		).toEqual({ status: 'degraded', label: 'Deploying' })
	})

	it('returns degraded with "Last build failed" when latest failed but a canonical still serves', () => {
		expect(
			computeProjectHealth([
				deployment('a', 'failure'),
				deployment('b', 'success'),
			]),
		).toEqual({ status: 'degraded', label: 'Last build failed' })
	})

	it('returns healthy Live when the latest production build succeeded', () => {
		expect(computeProjectHealth([deployment('a', 'success')])).toEqual({
			status: 'healthy',
			label: 'Live',
		})
	})

	it('treats canceled/skipped latest as healthy as long as a canonical exists', () => {
		expect(
			computeProjectHealth([
				deployment('a', 'canceled'),
				deployment('b', 'success'),
			]),
		).toEqual({ status: 'healthy', label: 'Live' })
	})
})
