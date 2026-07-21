import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { runExpositionEndpoint } from '@/lib/adapters/exposition-response.ts'
import {
	listBackupObjects,
	listWalgBaseBackupObjects,
} from '@/lib/adapters/r2/backups.ts'
import { getPostgresBackupCreds, getVpsState } from '@/lib/adapters/r2/state.ts'
import { listTaggedDevices } from '@/lib/adapters/tailscale/devices.ts'
import {
	renderBackupMetrics,
	renderWalgBackupMetrics,
} from '@/lib/domain/monitoring/backup-metrics.ts'
import { CLIENT_VPS_TAG } from '@/lib/domain/monitoring/sd-targets.ts'

import type { APIRoute } from 'astro'
import type { R2StateClient } from '@/lib/adapters/r2/state.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

// Backups are listed against the production environment's per-project token.
const BACKUP_ENVIRONMENT = 'production'

const resolveStateClient = (): R2StateClient => ({
	accountId: requireEnv(ENV_KEYS.CLOUDFLARE_ACCOUNT_ID),
	accessKeyId: requireEnv(ENV_KEYS.R2_ACCESS_KEY_ID),
	secretAccessKey: requireEnv(ENV_KEYS.R2_SECRET_ACCESS_KEY),
})

// The state token cannot read the backup buckets; swap in the project's
// dedicated backup token (persisted in the state bucket). Returns null when the
// project never provisioned postgres backups - it then has nothing to list.
const resolveBackupClient = async (
	stateClient: R2StateClient,
	project: string,
): Promise<R2StateClient | null> => {
	const creds = await getPostgresBackupCreds(
		stateClient,
		project,
		BACKUP_ENVIRONMENT,
	)
	if (creds === null) return null
	return {
		accountId: stateClient.accountId,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
	}
}

const listClientProjects = async (
	client: R2StateClient,
): Promise<ReadonlyArray<string>> => {
	const tsSecret = requireEnv(ENV_KEYS.TS_OAUTH_SECRET)
	const devices = await listTaggedDevices(tsSecret)
	const states = await Promise.all(
		devices
			.filter(device => device.tags.includes(CLIENT_VPS_TAG))
			.map(device => getVpsState(client, device.hostname)),
	)
	const projects = new Set<string>()
	for (const state of states) {
		for (const project of state?.projects ?? []) projects.add(project)
	}
	return [...projects].toSorted((a, b) => a.localeCompare(b))
}

const listObjectsOrNull = async <T>(
	backupClient: R2StateClient | null,
	project: string,
	lister: (client: R2StateClient, project: string) => Promise<T>,
): Promise<T | null> => {
	if (backupClient === null) return null
	return lister(backupClient, project)
}

/**
 * Prometheus exposition of backup freshness per project, scraped by the
 * vmagent `backups` job. The "push" sample the PRD describes is realised
 * as a pull: the control plane lists each project's backup buckets and
 * exposes the newest object's timestamp - no backup-container change, no
 * write credential anywhere new. Two metric families are emitted from the
 * same endpoint: pg_dump (logical) freshness and wal-g (physical base
 * backup) freshness, each alerted on independently by vmalert.
 */
export const GET: APIRoute = () =>
	runExpositionEndpoint('metrics.backups', async () => {
		const client = resolveStateClient()
		const projects = await listClientProjects(client)
		// One backup-scoped client per project (null when no backups exist).
		const backupClients = new Map(
			await Promise.all(
				projects.map(
					async project =>
						[
							project,
							await resolveBackupClient(client, project),
						] as const,
				),
			),
		)
		const [dumpEntries, walgEntries] = await Promise.all([
			Promise.all(
				projects.map(async project => {
					const backupClient = backupClients.get(project) ?? null
					return {
						project,
						objects: await listObjectsOrNull(
							backupClient,
							project,
							listBackupObjects,
						),
					}
				}),
			),
			Promise.all(
				projects.map(async project => {
					const backupClient = backupClients.get(project) ?? null
					return {
						project,
						objects: await listObjectsOrNull(
							backupClient,
							project,
							listWalgBaseBackupObjects,
						),
					}
				}),
			),
		])
		return `${renderBackupMetrics(dumpEntries)}${renderWalgBackupMetrics(walgEntries)}`
	})
