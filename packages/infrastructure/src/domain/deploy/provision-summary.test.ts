import { describe, expect, it } from 'vitest'

import { buildProvisionSummary } from './provision-summary.ts'
import type { ProvisionResult } from './target.ts'

describe('buildProvisionSummary', () => {
	it('renders a VPS provision summary with resource outcomes', () => {
		const result: ProvisionResult = {
			kind: 'vps',
			outcome: {
				server: { handled: true, detail: 'created #42' },
				firewall: { handled: true, detail: 'created' },
				tailscale: { handled: true, detail: 'joined (100.74.91.126)' },
				certs: {
					handled: false,
					detail: 'managed by Caddy at runtime',
				},
				dns: { handled: false, detail: 'managed by dns command' },
				state: { handled: true, detail: 'written (converged)' },
			},
			serverId: 42,
			serverType: 'cpx22',
			location: 'nbg1',
			publicIp: '1.2.3.4',
			tailnetIp: '100.74.91.126',
			durationMs: 135_000,
		}

		const summary = buildProvisionSummary(result, 'acme-web', 'hetzner-vps')

		expect(summary).toContain(
			'### :white_check_mark: Infrastructure ready for `acme-web`',
		)
		expect(summary).toContain('created #42')
		expect(summary).toContain('joined (100.74.91.126)')
		expect(summary).toContain('managed by dns command')
		expect(summary).toContain('hetzner-vps')
		expect(summary).toContain('2m 15s')
	})

	it('renders a static provision summary with resource outcomes', () => {
		const result: ProvisionResult = {
			kind: 'static',
			outcome: {
				'pages-project': {
					handled: true,
					detail: 'provisioned "my-site-6zu"',
				},
				dns: {
					handled: true,
					detail: 'domains reconciled for "my-site.com"',
				},
			},
			pagesProjectName: 'my-site-6zu',
			durationMs: 3_200,
		}

		const summary = buildProvisionSummary(
			result,
			'my-site',
			'cloudflare-pages',
		)

		expect(summary).toContain(
			'### :white_check_mark: Infrastructure ready for `my-site`',
		)
		expect(summary).toContain('provisioned "my-site-6zu"')
		expect(summary).toContain('domains reconciled for "my-site.com"')
		expect(summary).toContain('cloudflare-pages')
		expect(summary).toContain('3.2s')
	})
})
