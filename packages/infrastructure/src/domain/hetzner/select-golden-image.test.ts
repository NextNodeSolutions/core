import { describe, expect, it } from 'vitest'

import type { GoldenImageCandidate } from './select-golden-image.ts'
import { selectGoldenImage } from './select-golden-image.ts'

const NOW_MS = new Date('2026-04-22T12:00:00Z').getTime()
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function candidate(
	id: number,
	fingerprint: string,
	createdDaysAgo: number,
): GoldenImageCandidate {
	return {
		id,
		created: new Date(
			NOW_MS - createdDaysAgo * 24 * 60 * 60 * 1000,
		).toISOString(),
		labels: { infra_fingerprint: fingerprint },
	}
}

describe('selectGoldenImage', () => {
	it('rebuilds when there are no images at all', () => {
		const decision = selectGoldenImage({
			images: [],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision).toEqual({
			action: 'rebuild',
			reason: 'no snapshot matches fingerprint abc',
		})
	})

	it('rebuilds when no image has a matching fingerprint', () => {
		const decision = selectGoldenImage({
			images: [candidate(1, 'xxx', 1), candidate(2, 'yyy', 2)],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision).toEqual({
			action: 'rebuild',
			reason: 'no snapshot matches fingerprint abc',
		})
	})

	it('uses a fresh matching snapshot', () => {
		const decision = selectGoldenImage({
			images: [candidate(7, 'abc', 5)],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision).toEqual({
			action: 'use',
			imageId: 7,
			reason: 'snapshot 7 matches fingerprint abc',
		})
	})

	it('picks the newest among multiple matching snapshots', () => {
		const decision = selectGoldenImage({
			images: [
				candidate(1, 'abc', 20),
				candidate(2, 'abc', 3),
				candidate(3, 'abc', 10),
			],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision).toEqual({
			action: 'use',
			imageId: 2,
			reason: 'snapshot 2 matches fingerprint abc',
		})
	})

	it('rebuilds when the only matching snapshot is older than maxAge', () => {
		const decision = selectGoldenImage({
			images: [candidate(9, 'abc', 45)],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision).toEqual({
			action: 'rebuild',
			reason: 'snapshot 9 is 45d old (max 30d)',
		})
	})

	it('treats an exactly-maxAge snapshot as still fresh (strict > comparison)', () => {
		const decision = selectGoldenImage({
			images: [candidate(5, 'abc', 30)],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision.action).toBe('use')
	})

	it('ignores images whose fingerprint label is missing entirely', () => {
		const imageWithoutFingerprint: GoldenImageCandidate = {
			id: 42,
			created: new Date(NOW_MS).toISOString(),
			labels: { managed_by: 'nextnode-golden-image' },
		}
		const decision = selectGoldenImage({
			images: [imageWithoutFingerprint],
			currentFingerprint: 'abc',
			nowMs: NOW_MS,
			maxAgeMs: MAX_AGE_MS,
		})
		expect(decision.action).toBe('rebuild')
	})
})
