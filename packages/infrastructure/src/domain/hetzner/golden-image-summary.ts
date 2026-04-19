export type GoldenImageSummaryInput =
	| {
			readonly kind: 'cached'
			readonly fingerprint: string
			readonly snapshotId: number
	  }
	| {
			readonly kind: 'built'
			readonly fingerprint: string
			readonly cleanupError: string | null
	  }

export function formatGoldenImageSummary(
	input: GoldenImageSummaryInput,
): string {
	if (input.kind === 'cached') {
		return `### Golden Image\n\nUp to date - snapshot \`${input.snapshotId}\` matches fingerprint \`${input.fingerprint}\``
	}
	const built = `### Golden Image\n\nBuilt new snapshot \`nextnode-base-${input.fingerprint}\` with fingerprint \`${input.fingerprint}\``
	if (input.cleanupError === null) return built
	return `${built}\n\n> ⚠️ Pruning of old snapshots failed (non-fatal): ${input.cleanupError}`
}
