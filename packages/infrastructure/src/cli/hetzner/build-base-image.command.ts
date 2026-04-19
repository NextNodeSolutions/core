import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import { writeSummary } from '../../adapters/github/output.ts'
import {
	deleteImage,
	findImagesByLabels,
} from '../../adapters/hetzner/api/client.ts'
import {
	MAX_GOLDEN_IMAGE_SNAPSHOTS,
	PACKER_MANAGED_BY_LABEL,
} from '../../adapters/hetzner/constants.ts'
import { formatGoldenImageSummary } from '../../domain/hetzner/golden-image-summary.ts'
import { computeInfraFingerprint } from '../../domain/hetzner/infra-fingerprint.ts'
import { requireEnv } from '../env.ts'

const logger = createLogger()

const PACKER_DIR = 'packer'
const PACKER_TEMPLATE = 'nextnode-base.pkr.hcl'
const SETUP_SCRIPT = 'scripts/setup.sh'

function readPackerFiles(packerDir: string): ReadonlyArray<string> {
	const templatePath = resolve(packerDir, PACKER_TEMPLATE)
	const scriptPath = resolve(packerDir, SETUP_SCRIPT)
	return [
		readFileSync(templatePath, 'utf8'),
		readFileSync(scriptPath, 'utf8'),
	]
}

async function cleanupOldSnapshots(
	token: string,
	keepCount: number,
): Promise<void> {
	const allSnapshots = await findImagesByLabels(token, {
		managed_by: PACKER_MANAGED_BY_LABEL,
	})
	if (allSnapshots.length <= keepCount) return

	const sorted = allSnapshots.toSorted(
		(a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
	)
	const toDelete = sorted.slice(keepCount)

	await Promise.all(
		toDelete.map(snapshot => {
			logger.info(
				`Deleting old snapshot ${snapshot.id} ("${snapshot.description}", created ${snapshot.created})`,
			)
			return deleteImage(token, snapshot.id)
		}),
	)
}

export async function buildBaseImageCommand(): Promise<void> {
	const token = requireEnv('HETZNER_API_TOKEN')
	const packerDir = resolve(process.cwd(), PACKER_DIR)

	const fileContents = readPackerFiles(packerDir)
	const fingerprint = computeInfraFingerprint(fileContents)
	logger.info(`Infra fingerprint: ${fingerprint}`)

	const existing = await findImagesByLabels(token, {
		managed_by: PACKER_MANAGED_BY_LABEL,
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

	logger.info('No matching golden image found, building with Packer...')

	// Array form (execFileSync) bypasses the shell entirely, so the
	// fingerprint — even though it is a SHA256 hex string today — cannot
	// reach a shell interpreter. Defense in depth against a future change
	// that might let a non-hex value slip into computeInfraFingerprint.
	execFileSync('packer', ['init', '.'], {
		cwd: packerDir,
		stdio: 'inherit',
		env: { ...process.env, HCLOUD_TOKEN: token },
	})

	execFileSync(
		'packer',
		['build', '-var', `infra_fingerprint=${fingerprint}`, '.'],
		{
			cwd: packerDir,
			stdio: 'inherit',
			env: { ...process.env, HCLOUD_TOKEN: token },
		},
	)

	logger.info(
		`Golden image built: snapshot nextnode-base-${fingerprint} (fingerprint ${fingerprint})`,
	)

	const cleanupError = await pruneOldSnapshotsBestEffort(
		token,
		MAX_GOLDEN_IMAGE_SNAPSHOTS,
	)

	writeSummary(
		formatGoldenImageSummary({ kind: 'built', fingerprint, cleanupError }),
	)
}

// Business rule: pruning is maintenance — failures are logged + surfaced in the summary, never fatal.
async function pruneOldSnapshotsBestEffort(
	token: string,
	keepCount: number,
): Promise<string | null> {
	try {
		logger.info('Pruning old snapshots...')
		await cleanupOldSnapshots(token, keepCount)
		return null
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		logger.warn(`Pruning of old snapshots failed (non-fatal): ${message}`)
		return message
	}
}
