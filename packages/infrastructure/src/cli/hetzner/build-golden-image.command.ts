import { createLogger } from '@nextnode-solutions/logger'

import { writeSummary } from '@/adapters/github/output.ts'
import {
	deleteImage,
	findImagesByLabels,
} from '@/adapters/hetzner/api/image.ts'
import {
	GOLDEN_IMAGE_LABEL,
	MAX_GOLDEN_IMAGE_SNAPSHOTS,
} from '@/adapters/hetzner/constants.ts'
import { buildGoldenImage } from '@/adapters/hetzner/provision/build-golden-image.ts'
import { requireEnv } from '@/cli/env.ts'
import { formatGoldenImageSummary } from '@/domain/hetzner/golden-image-summary.ts'
import { goldenImageFingerprint } from '@/domain/hetzner/golden-image.ts'

const logger = createLogger()

export async function buildGoldenImageCommand(): Promise<void> {
	const token = requireEnv('HETZNER_API_TOKEN')
	const fingerprint = goldenImageFingerprint()
	logger.info(`Golden image fingerprint: ${fingerprint}`)

	const existing = await findImagesByLabels(token, {
		managed_by: GOLDEN_IMAGE_LABEL,
		infra_fingerprint: fingerprint,
	})

	const cached = existing[0]
	if (cached) {
		logger.info(
			`Golden image already up to date (snapshot ${cached.id}, fingerprint ${fingerprint})`,
		)
		writeSummary(
			formatGoldenImageSummary({
				kind: 'cached',
				fingerprint,
				snapshotId: cached.id,
			}),
		)
		return
	}

	logger.info('No matching golden image, building one...')
	const { snapshotId } = await buildGoldenImage(token)
	logger.info(
		`Golden image built: snapshot ${snapshotId} (fingerprint ${fingerprint})`,
	)

	const cleanupError = await pruneOldSnapshots(
		token,
		MAX_GOLDEN_IMAGE_SNAPSHOTS,
	)

	writeSummary(
		formatGoldenImageSummary({ kind: 'built', fingerprint, cleanupError }),
	)
}

// Pruning is best-effort maintenance: a failure gets surfaced in the summary
// but never fails the build.
async function pruneOldSnapshots(
	token: string,
	keepCount: number,
): Promise<string | null> {
	try {
		logger.info('Pruning old snapshots...')
		const snapshots = await findImagesByLabels(token, {
			managed_by: GOLDEN_IMAGE_LABEL,
		})
		if (snapshots.length <= keepCount) return null

		const toDelete = snapshots
			.toSorted(
				(a, b) =>
					new Date(b.created).getTime() -
					new Date(a.created).getTime(),
			)
			.slice(keepCount)

		await Promise.all(
			toDelete.map(snapshot => {
				logger.info(
					`Deleting old snapshot ${snapshot.id} ("${snapshot.description}", created ${snapshot.created})`,
				)
				return deleteImage(token, snapshot.id)
			}),
		)
		return null
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		logger.warn(`Pruning of old snapshots failed (non-fatal): ${message}`)
		return message
	}
}
