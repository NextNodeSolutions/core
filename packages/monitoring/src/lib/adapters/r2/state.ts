import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'
import { signSigV4Request } from '@/lib/domain/aws/sigv4.ts'
import { parseVpsState } from '@/lib/domain/hetzner/vps-state.ts'
import { parsePostgresBackupCreds } from '@/lib/domain/services/postgres-backup-creds.ts'

import type { VpsStateSlice } from '@/lib/domain/hetzner/vps-state.ts'
import type { PostgresBackupCreds } from '@/lib/domain/services/postgres-backup-creds.ts'

const STATE_BUCKET = 'nextnode-state'
const R2_REGION = 'auto'
const HTTP_NOT_FOUND = 404

export interface R2StateClient {
	readonly accountId: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

export class R2StateApiFailure extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly body: string,
	) {
		super(context, httpStatus, `${context}: HTTP ${String(httpStatus)}`)
	}

	logContext(): Record<string, unknown> {
		return { body: this.body }
	}
}

const fetchVpsState = async (args: {
	client: R2StateClient
	hostname: string
}): Promise<VpsStateSlice | null> => {
	const host = `${args.client.accountId}.r2.cloudflarestorage.com`
	const path = `/${STATE_BUCKET}/hetzner/${args.hostname}.json`
	const signed = signSigV4Request({
		accessKeyId: args.client.accessKeyId,
		secretAccessKey: args.client.secretAccessKey,
		method: 'GET',
		host,
		path,
		query: '',
		region: R2_REGION,
		service: 's3',
		payload: '',
		now: new Date(),
	})

	const response = await fetch(signed.url, { headers: signed.headers })
	// A VPS without state simply has not been provisioned (or was torn
	// down) - that is an answer, not an error.
	if (response.status === HTTP_NOT_FOUND) return null
	if (!response.ok) {
		throw new R2StateApiFailure(
			`r2-state get hetzner/${args.hostname}.json`,
			response.status,
			await response.text(),
		)
	}
	const payload: unknown = await response.json()
	return parseVpsState(payload)
}

// vmagent polls the SD endpoint every 60 s; one state read per VPS per
// window is plenty fresh (the state changes on provision/deploy only).
const STATE_TTL_MS = 60_000

const memoizedGetVpsState = keyedMemoizeAsync(
	STATE_TTL_MS,
	(args: { client: R2StateClient; hostname: string }) =>
		`${args.client.accountId} ${args.hostname}`,
	fetchVpsState,
)

/** Read the SD slice of a VPS's infra state; null when none exists. */
export const getVpsState = (
	client: R2StateClient,
	hostname: string,
): Promise<VpsStateSlice | null> => memoizedGetVpsState({ client, hostname })

// Read the per-project backup R2 token from the state bucket. The state token
// can read the state bucket (where this object lives) but NOT the backup
// buckets it grants - so the caller uses the returned creds to list backups.
const fetchPostgresBackupCreds = async (args: {
	client: R2StateClient
	project: string
	environment: string
}): Promise<PostgresBackupCreds | null> => {
	const host = `${args.client.accountId}.r2.cloudflarestorage.com`
	const path = `/${STATE_BUCKET}/services/postgres-backup/${args.project}/${args.environment}.json`
	const signed = signSigV4Request({
		accessKeyId: args.client.accessKeyId,
		secretAccessKey: args.client.secretAccessKey,
		method: 'GET',
		host,
		path,
		query: '',
		region: R2_REGION,
		service: 's3',
		payload: '',
		now: new Date(),
	})

	const response = await fetch(signed.url, { headers: signed.headers })
	// No creds object = the project never provisioned postgres backups.
	if (response.status === HTTP_NOT_FOUND) return null
	if (!response.ok) {
		throw new R2StateApiFailure(
			`r2-state get services/postgres-backup/${args.project}/${args.environment}.json`,
			response.status,
			await response.text(),
		)
	}
	return parsePostgresBackupCreds(await response.json())
}

const memoizedGetPostgresBackupCreds = keyedMemoizeAsync(
	STATE_TTL_MS,
	(args: { client: R2StateClient; project: string; environment: string }) =>
		`${args.client.accountId} backup-creds ${args.project} ${args.environment}`,
	fetchPostgresBackupCreds,
)

/**
 * Read a project's backup R2 token (scoped to its backup buckets); null when
 * the project has no provisioned postgres backups.
 */
export const getPostgresBackupCreds = (
	client: R2StateClient,
	project: string,
	environment: string,
): Promise<PostgresBackupCreds | null> =>
	memoizedGetPostgresBackupCreds({ client, project, environment })
