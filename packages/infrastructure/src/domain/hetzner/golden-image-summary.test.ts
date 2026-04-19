import { describe, expect, it } from 'vitest'

import { formatGoldenImageSummary } from './golden-image-summary.ts'

describe('formatGoldenImageSummary', () => {
	it('reports an up-to-date snapshot when the fingerprint already matches', () => {
		const markdown = formatGoldenImageSummary({
			kind: 'cached',
			fingerprint: 'abc123',
			snapshotId: 42,
		})

		expect(markdown).toBe(
			'### Golden Image\n\nUp to date - snapshot `42` matches fingerprint `abc123`',
		)
	})

	it('reports a newly built snapshot by fingerprint when cleanup succeeds', () => {
		const markdown = formatGoldenImageSummary({
			kind: 'built',
			fingerprint: '5d53b5620d8feac1',
			cleanupError: null,
		})

		expect(markdown).toBe(
			'### Golden Image\n\nBuilt new snapshot `nextnode-base-5d53b5620d8feac1` with fingerprint `5d53b5620d8feac1`',
		)
	})

	it('appends a non-fatal warning when pruning old snapshots fails', () => {
		const markdown = formatGoldenImageSummary({
			kind: 'built',
			fingerprint: '5d53b5620d8feac1',
			cleanupError: 'fetch failed: SocketError: other side closed',
		})

		expect(markdown).toBe(
			'### Golden Image\n\n' +
				'Built new snapshot `nextnode-base-5d53b5620d8feac1` with fingerprint `5d53b5620d8feac1`\n\n' +
				'> ⚠️ Pruning of old snapshots failed (non-fatal): fetch failed: SocketError: other side closed',
		)
	})
})
