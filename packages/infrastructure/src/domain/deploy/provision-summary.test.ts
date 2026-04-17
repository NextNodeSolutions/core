import { describe, expect, it } from 'vitest'

import { buildProvisionSummary } from './provision-summary.ts'
import type { ProvisionResult } from './target.ts'

describe('buildProvisionSummary', () => {
	it('renders a VPS provision summary with server details', () => {
		const result: ProvisionResult = {
			kind: 'vps',
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
		expect(summary).toContain('#42 (cpx22 / nbg1)')
		expect(summary).toContain('1.2.3.4')
		expect(summary).toContain('100.74.91.126')
		expect(summary).toContain('hetzner-vps')
		expect(summary).toContain('2m 15s')
	})

	it('renders a static provision summary with Pages project name', () => {
		const result: ProvisionResult = {
			kind: 'static',
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
		expect(summary).toContain('my-site-6zu')
		expect(summary).toContain('cloudflare-pages')
		expect(summary).toContain('3.2s')
		expect(summary).not.toContain('**Server**')
		expect(summary).not.toContain('**Public IP**')
	})
})
