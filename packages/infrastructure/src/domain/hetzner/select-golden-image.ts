export interface GoldenImageCandidate {
	readonly id: number
	readonly created: string
	readonly labels: Readonly<Record<string, string>>
}

export interface SelectGoldenImageInput {
	readonly images: ReadonlyArray<GoldenImageCandidate>
	readonly currentFingerprint: string
	readonly nowMs: number
	readonly maxAgeMs: number
}

export type GoldenImageDecision =
	| {
			readonly action: 'use'
			readonly imageId: number
			readonly reason: string
	  }
	| { readonly action: 'rebuild'; readonly reason: string }

const FINGERPRINT_LABEL = 'infra_fingerprint'
const MS_PER_DAY = 86_400_000

function toDays(ms: number): number {
	return Math.round(ms / MS_PER_DAY)
}

/**
 * Decide whether to reuse an existing golden image snapshot or rebuild one.
 *
 * Rebuild triggers:
 *   - No snapshot has a fingerprint label matching the current source code
 *     (base image cloud-init changed).
 *   - The newest matching snapshot is older than `maxAgeMs` (refresh security
 *     updates baked into the underlying Debian).
 *
 * The two signals are combined on purpose: the hash alone catches code
 * changes, age alone catches upstream updates, both together cover both
 * sources of drift.
 */
export function selectGoldenImage(
	input: SelectGoldenImageInput,
): GoldenImageDecision {
	const matching = input.images.filter(
		image => image.labels[FINGERPRINT_LABEL] === input.currentFingerprint,
	)
	if (matching.length === 0) {
		return {
			action: 'rebuild',
			reason: `no snapshot matches fingerprint ${input.currentFingerprint}`,
		}
	}

	const newest = matching.toSorted(
		(a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
	)[0]
	if (!newest) {
		return {
			action: 'rebuild',
			reason: `no snapshot matches fingerprint ${input.currentFingerprint}`,
		}
	}

	const ageMs = input.nowMs - new Date(newest.created).getTime()
	if (ageMs > input.maxAgeMs) {
		return {
			action: 'rebuild',
			reason: `snapshot ${newest.id} is ${toDays(ageMs)}d old (max ${toDays(input.maxAgeMs)}d)`,
		}
	}

	return {
		action: 'use',
		imageId: newest.id,
		reason: `snapshot ${newest.id} matches fingerprint ${input.currentFingerprint}`,
	}
}
