import { describe, expect, it } from 'vitest'

import { buildDeploySummary, formatDuration } from './deploy-summary.ts'
import type { DeployResult } from './target.ts'

describe('buildDeploySummary', () => {
	it('renders a container deploy with image ref', () => {
		const result: DeployResult = {
			projectName: 'test-e2e',
			durationMs: 12_300,
			deployedEnvironments: [
				{
					kind: 'container',
					name: 'development',
					url: 'https://dev.vps-e2e.nextnode.fr',
					deployedAt: new Date('2026-04-17T12:00:00Z'),
					imageRef: {
						registry: 'ghcr.io',
						repository: 'nextnodessolutions/test-e2e',
						tag: 'sha-abc1234',
					},
				},
			],
		}

		const summary = buildDeploySummary(result, 'hetzner-vps')

		expect(summary).toContain(
			'### :rocket: Deployed `test-e2e` to development',
		)
		expect(summary).toContain('https://dev.vps-e2e.nextnode.fr')
		expect(summary).toContain(
			'`ghcr.io/nextnodessolutions/test-e2e:sha-abc1234`',
		)
		expect(summary).toContain('hetzner-vps')
		expect(summary).toContain('12.3s')
	})

	it('renders a static deploy without image ref', () => {
		const result: DeployResult = {
			projectName: 'my-site',
			durationMs: 3_500,
			deployedEnvironments: [
				{
					kind: 'static',
					name: 'production',
					url: 'https://my-site.pages.dev',
					deployedAt: new Date('2026-04-17T12:00:00Z'),
				},
			],
		}

		const summary = buildDeploySummary(result, 'cloudflare-pages')

		expect(summary).toContain(
			'### :rocket: Deployed `my-site` to production',
		)
		expect(summary).toContain('https://my-site.pages.dev')
		expect(summary).toContain('cloudflare-pages')
		expect(summary).not.toContain('**Image**')
	})

	it('handles empty deployed environments', () => {
		const result: DeployResult = {
			projectName: 'empty',
			durationMs: 100,
			deployedEnvironments: [],
		}

		const summary = buildDeploySummary(result, 'hetzner-vps')

		expect(summary).toBe('### :rocket: Deploy complete for `empty`')
	})
})

describe('formatDuration', () => {
	it('formats sub-second durations as milliseconds', () => {
		expect(formatDuration(500)).toBe('500ms')
		expect(formatDuration(0)).toBe('0ms')
		expect(formatDuration(999)).toBe('999ms')
	})

	it('formats seconds with one decimal place', () => {
		expect(formatDuration(1_000)).toBe('1.0s')
		expect(formatDuration(12_300)).toBe('12.3s')
		expect(formatDuration(59_900)).toBe('59.9s')
	})

	it('formats minutes and seconds', () => {
		expect(formatDuration(60_000)).toBe('1m')
		expect(formatDuration(90_000)).toBe('1m 30s')
		expect(formatDuration(125_000)).toBe('2m 5s')
	})
})
