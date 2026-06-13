import { describe, expect, it } from 'vitest'

import { runSdEndpoint } from './sd-endpoint-runner.ts'

import type { SdTargetGroup } from '@/lib/domain/monitoring/sd-targets.ts'

const GROUPS: ReadonlyArray<SdTargetGroup> = [
	{
		targets: ['100.64.0.1:9100'],
		labels: { __meta_nextnode_exporter: 'node' },
	},
]

describe('runSdEndpoint', () => {
	it('serves the target groups as a BARE JSON array (no {ok,data} envelope)', async () => {
		const response = await runSdEndpoint('sd.test', async () => GROUPS)

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'application/json; charset=utf-8',
		)
		const body: unknown = await response.json()
		// vmagent rejects an envelope - the body must be the array itself, not
		// wrapped in { ok, data }.
		expect(Array.isArray(body)).toBe(true)
		expect(body).toEqual(GROUPS)
	})

	it('returns a plain 500 with an {error} body when the fetcher throws', async () => {
		const response = await runSdEndpoint('sd.test', async () => {
			throw new Error('tailscale unreachable')
		})

		expect(response.status).toBe(500)
		const body: unknown = await response.json()
		// On failure the body is NOT a target array - vmagent keeps its previous
		// target list on a non-200, so the shape just has to be valid JSON.
		expect(Array.isArray(body)).toBe(false)
		expect(body).toEqual({ error: 'tailscale unreachable' })
	})
})
