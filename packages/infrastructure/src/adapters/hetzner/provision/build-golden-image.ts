import { createSnapshot, findImageById } from '#/adapters/hetzner/api/image.ts'
import type { CreateServerInput } from '#/adapters/hetzner/api/server.ts'
import {
	createServer,
	deleteServer,
	describeServer,
} from '#/adapters/hetzner/api/server.ts'
import {
	GOLDEN_IMAGE_BUILDER_LABEL,
	GOLDEN_IMAGE_BUILDER_LOCATION,
	GOLDEN_IMAGE_BUILDER_SERVER_TYPE,
	GOLDEN_IMAGE_LABEL,
	GOLDEN_IMAGE_POLL_INTERVAL_MS,
	HCLOUD_IMAGE,
	MAX_GOLDEN_IMAGE_BUILD_ATTEMPTS,
	MAX_SNAPSHOT_ATTEMPTS,
	SNAPSHOT_POLL_INTERVAL_MS,
} from '#/adapters/hetzner/constants.ts'
import { waitUntil } from '#/adapters/hetzner/wait.ts'
import {
	goldenImageFingerprint,
	renderGoldenImageCloudInit,
} from '#/domain/hetzner/golden-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

// Enough entropy to dodge hostname collisions across parallel builder runs,
// kept short so the server name stays readable in the Hetzner console.
const BUILDER_NAME_RANDOM_LENGTH = 6
const FINGERPRINT_PREFIX_LENGTH = 8
const HEX_RADIX = 16
// Math.random().toString(16) yields "0.<hex>" — skip the "0." prefix.
const RANDOM_HEX_PREFIX_SKIP = 2

export interface BuildGoldenImageResult {
	readonly snapshotId: number
	readonly fingerprint: string
}

function builderName(fingerprint: string): string {
	const random = Math.random()
		.toString(HEX_RADIX)
		.slice(
			RANDOM_HEX_PREFIX_SKIP,
			RANDOM_HEX_PREFIX_SKIP + BUILDER_NAME_RANDOM_LENGTH,
		)
	return `nextnode-golden-builder-${fingerprint.slice(0, FINGERPRINT_PREFIX_LENGTH)}-${random}`
}

/**
 * Build a fresh golden image. The builder VPS is always deleted in `finally`
 * — leaving it behind would silently accrue Hetzner billing.
 */
export async function buildGoldenImage(
	token: string,
): Promise<BuildGoldenImageResult> {
	const fingerprint = goldenImageFingerprint()
	const userData = renderGoldenImageCloudInit()
	const name = builderName(fingerprint)

	const input: CreateServerInput = {
		name,
		serverType: GOLDEN_IMAGE_BUILDER_SERVER_TYPE,
		location: GOLDEN_IMAGE_BUILDER_LOCATION,
		image: HCLOUD_IMAGE,
		userData,
		labels: {
			managed_by: GOLDEN_IMAGE_BUILDER_LABEL,
			infra_fingerprint: fingerprint,
		},
	}

	logger.info(`Creating builder VPS "${name}" for fingerprint ${fingerprint}`)
	const server = await createServer(token, input)

	try {
		logger.info(
			`Waiting for builder VPS ${server.id} to complete cloud-init and power off`,
		)
		await waitUntil({
			subject: `Builder VPS ${server.id} cloud-init + shutdown`,
			poll: () => describeServer(token, server.id),
			isDone: s => s.status === 'off',
			detail: s => `status=${s.status}`,
			maxAttempts: MAX_GOLDEN_IMAGE_BUILD_ATTEMPTS,
			intervalMs: GOLDEN_IMAGE_POLL_INTERVAL_MS,
		})

		logger.info(
			`Creating snapshot for builder VPS ${server.id} (fingerprint ${fingerprint})`,
		)
		const snapshot = await createSnapshot(token, server.id, {
			description: `nextnode-golden-${fingerprint}`,
			labels: {
				managed_by: GOLDEN_IMAGE_LABEL,
				infra_fingerprint: fingerprint,
			},
		})

		await waitUntil({
			subject: `Snapshot ${snapshot.id}`,
			poll: async () => {
				const image = await findImageById(token, snapshot.id)
				if (!image) {
					throw new Error(
						`Snapshot ${snapshot.id} disappeared while polling`,
					)
				}
				return image
			},
			isDone: image => image.status === 'available',
			detail: image => `status=${image.status}`,
			maxAttempts: MAX_SNAPSHOT_ATTEMPTS,
			intervalMs: SNAPSHOT_POLL_INTERVAL_MS,
		})

		return { snapshotId: snapshot.id, fingerprint }
	} finally {
		await safeDeleteServer(token, server.id)
	}
}

async function safeDeleteServer(
	token: string,
	serverId: number,
): Promise<void> {
	try {
		await deleteServer(token, serverId)
		logger.info(`Deleted builder VPS ${serverId}`)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		logger.warn(
			`Failed to delete builder VPS ${serverId} (non-fatal, delete manually): ${message}`,
		)
	}
}
