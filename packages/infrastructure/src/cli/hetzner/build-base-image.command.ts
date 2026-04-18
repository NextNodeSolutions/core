import { execSync } from 'node:child_process'
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
			`### Golden Image\n\nUp to date - snapshot \`${cached.id}\` matches fingerprint \`${fingerprint}\``,
		)
		return
	}

	logger.info('No matching golden image found, building with Packer...')

	execSync('packer init .', {
		cwd: packerDir,
		stdio: 'inherit',
		env: { ...process.env, HCLOUD_TOKEN: token },
	})

	execSync(`packer build -var "infra_fingerprint=${fingerprint}" .`, {
		cwd: packerDir,
		stdio: 'inherit',
		env: { ...process.env, HCLOUD_TOKEN: token },
	})

	logger.info('Packer build complete, cleaning up old snapshots...')
	await cleanupOldSnapshots(token, MAX_GOLDEN_IMAGE_SNAPSHOTS)

	const newSnapshots = await findImagesByLabels(token, {
		managed_by: PACKER_MANAGED_BY_LABEL,
		infra_fingerprint: fingerprint,
	})
	const snapshotId = newSnapshots[0]?.id ?? 'unknown'

	logger.info(`Golden image built: snapshot ${snapshotId}`)
	writeSummary(
		`### Golden Image\n\nBuilt new snapshot \`${snapshotId}\` with fingerprint \`${fingerprint}\``,
	)
}
