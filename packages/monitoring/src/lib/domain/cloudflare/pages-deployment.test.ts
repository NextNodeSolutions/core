import { describe, expect, it } from 'vitest'

import {
	findCanonicalProductionDeployment,
	findRollbackCandidate,
} from '@/lib/domain/cloudflare/pages-deployment.ts'
import type {
	CloudflarePagesDeployment,
	CloudflarePagesDeploymentEnvironment,
	CloudflarePagesDeploymentStatus,
} from '@/lib/domain/cloudflare/pages-deployment.ts'

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

describe('findCanonicalProductionDeployment', () => {
	it('returns null when no deployment exists', () => {
		expect(findCanonicalProductionDeployment([])).toBeNull()
	})

	it('returns null when no production deployment has succeeded', () => {
		const deployments = [
			deployment('a', 'failure'),
			deployment('b', 'success', 'preview'),
		]
		expect(findCanonicalProductionDeployment(deployments)).toBeNull()
	})

	it('returns the first successful production deployment (newest-first order)', () => {
		const newest = deployment('a', 'success')
		const older = deployment('b', 'success')
		expect(findCanonicalProductionDeployment([newest, older])).toBe(newest)
	})

	it('ignores successful preview deployments', () => {
		const preview = deployment('a', 'success', 'preview')
		const prod = deployment('b', 'success')
		expect(findCanonicalProductionDeployment([preview, prod])).toBe(prod)
	})
})

describe('findRollbackCandidate', () => {
	it('returns null when no canonical production deployment exists', () => {
		expect(findRollbackCandidate([deployment('a', 'failure')])).toBeNull()
	})

	it('returns null when the canonical deployment is the only healthy production one', () => {
		const deployments = [
			deployment('a', 'success'),
			deployment('b', 'failure'),
		]
		expect(findRollbackCandidate(deployments)).toBeNull()
	})

	it('returns the next successful production deployment after the canonical one', () => {
		const current = deployment('a', 'success')
		const previous = deployment('b', 'success')
		expect(findRollbackCandidate([current, previous])).toBe(previous)
	})

	it('skips preview successes when looking for a rollback candidate', () => {
		const current = deployment('a', 'success')
		const preview = deployment('b', 'success', 'preview')
		const previous = deployment('c', 'success')
		expect(findRollbackCandidate([current, preview, previous])).toBe(
			previous,
		)
	})
})
