import { describe, expect, it } from 'vitest'

import { validateTeardownOptions } from './teardown-target.ts'

describe('validateTeardownOptions', () => {
	it('accepts any combination for hetzner-vps deploys', () => {
		expect(() =>
			validateTeardownOptions('hetzner-vps', 'project', false),
		).not.toThrow()
		expect(() =>
			validateTeardownOptions('hetzner-vps', 'project', true),
		).not.toThrow()
		expect(() =>
			validateTeardownOptions('hetzner-vps', 'vps', false),
		).not.toThrow()
		expect(() =>
			validateTeardownOptions('hetzner-vps', 'vps', true),
		).not.toThrow()
	})

	it('accepts project + shouldWipeVolumes=false for cloudflare-pages deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-pages', 'project', false),
		).not.toThrow()
	})

	it('accepts project + shouldWipeVolumes=false for cloudflare-workers deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-workers', 'project', false),
		).not.toThrow()
	})

	it('rejects vps scope for cloudflare-pages deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-pages', 'vps', false),
		).toThrow(
			/TEARDOWN_TARGET="vps" is not supported for "cloudflare-pages"/,
		)
	})

	it('rejects vps scope for cloudflare-workers deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-workers', 'vps', false),
		).toThrow(
			/TEARDOWN_TARGET="vps" is not supported for "cloudflare-workers"/,
		)
	})

	it('rejects shouldWipeVolumes=true for cloudflare-pages deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-pages', 'project', true),
		).toThrow(
			/TEARDOWN_WITH_VOLUMES=true is not supported for "cloudflare-pages"/,
		)
	})

	it('rejects shouldWipeVolumes=true for cloudflare-workers deploys', () => {
		expect(() =>
			validateTeardownOptions('cloudflare-workers', 'project', true),
		).toThrow(
			/TEARDOWN_WITH_VOLUMES=true is not supported for "cloudflare-workers"/,
		)
	})
})
