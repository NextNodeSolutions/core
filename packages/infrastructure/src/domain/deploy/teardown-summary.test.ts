import { describe, expect, it } from 'vitest'

import type { TeardownResult } from './teardown-result.ts'
import { buildTeardownSummary } from './teardown-summary.ts'

describe('buildTeardownSummary', () => {
	it('renders a VPS teardown summary with resource outcomes', () => {
		const result: TeardownResult = {
			kind: 'vps',
			scope: 'vps',
			outcome: {
				server: { handled: true, detail: 'deleted #42' },
				firewall: { handled: true, detail: 'deleted' },
				tailscale: { handled: true, detail: '1 device(s) purged' },
				dns: { handled: true, detail: '2 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 5_400,
		}

		const summary = buildTeardownSummary(result, 'acme-web', 'hetzner-vps')

		expect(summary).toContain(
			'### :wastebasket: Infrastructure torn down for `acme-web`',
		)
		expect(summary).toContain('deleted #42')
		expect(summary).toContain('1 device(s) purged')
		expect(summary).toContain('2 record(s) deleted')
		expect(summary).toContain('hetzner-vps')
		expect(summary).toContain('5.4s')
	})

	it('renders a VPS teardown with server already gone', () => {
		const result: TeardownResult = {
			kind: 'vps',
			scope: 'vps',
			outcome: {
				server: { handled: false, detail: 'already gone' },
				firewall: { handled: false, detail: 'not found' },
				tailscale: { handled: false, detail: '0 device(s) purged' },
				dns: { handled: false, detail: '0 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 800,
		}

		const summary = buildTeardownSummary(result, 'acme-web', 'hetzner-vps')

		expect(summary).toContain('already gone')
		expect(summary).toContain('not found')
		expect(summary).toContain('800ms')
	})

	it('renders a static teardown summary', () => {
		const result: TeardownResult = {
			kind: 'static',
			scope: 'project',
			pagesProjectName: 'my-site-dev',
			outcome: {
				'pages-project': { handled: true, detail: 'deleted' },
				dns: { handled: true, detail: '1 record(s) deleted' },
			},
			durationMs: 2_100,
		}

		const summary = buildTeardownSummary(
			result,
			'my-site',
			'cloudflare-pages',
		)

		expect(summary).toContain(
			'### :wastebasket: Infrastructure torn down for `my-site`',
		)
		expect(summary).toContain('deleted')
		expect(summary).toContain('1 record(s) deleted')
		expect(summary).toContain('cloudflare-pages')
		expect(summary).toContain('2.1s')
	})

	it('renders a static teardown with project already gone', () => {
		const result: TeardownResult = {
			kind: 'static',
			scope: 'project',
			pagesProjectName: 'my-site-dev',
			outcome: {
				'pages-project': { handled: false, detail: 'already gone' },
				dns: { handled: false, detail: '0 record(s) deleted' },
			},
			durationMs: 300,
		}

		const summary = buildTeardownSummary(
			result,
			'my-site',
			'cloudflare-pages',
		)

		expect(summary).toContain('already gone')
		expect(summary).toContain('300ms')
	})
})
