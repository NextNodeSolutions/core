import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

import type { PostgresBackupCredsState } from '#/domain/services/postgres-backup.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'

function parseState(raw: string, key: string): PostgresBackupCredsState {
	const parsedState: unknown = parseJsonOrThrow(
		raw,
		`Invalid postgres backup state at "${key}"`,
	)
	if (!isRecord(parsedState)) {
		throw new Error(
			`Invalid postgres backup state at "${key}": not an object`,
		)
	}
	const { endpoint } = parsedState
	const { accessKeyId } = parsedState
	const { secretAccessKey } = parsedState
	if (typeof endpoint !== 'string' || endpoint === '') {
		throw new Error(
			`Invalid postgres backup state at "${key}": missing endpoint`,
		)
	}
	if (typeof accessKeyId !== 'string' || accessKeyId === '') {
		throw new Error(
			`Invalid postgres backup state at "${key}": missing accessKeyId`,
		)
	}
	if (typeof secretAccessKey !== 'string' || secretAccessKey === '') {
		throw new Error(
			`Invalid postgres backup state at "${key}": missing secretAccessKey`,
		)
	}
	return { endpoint, accessKeyId, secretAccessKey }
}

export async function readPostgresBackupState(
	r2: ObjectStoreClient,
	key: string,
): Promise<PostgresBackupCredsState | null> {
	const stored = await r2.get(key)
	if (!stored) return null
	return parseState(stored.body, key)
}

export async function writePostgresBackupState(
	r2: ObjectStoreClient,
	key: string,
	state: PostgresBackupCredsState,
): Promise<void> {
	await r2.put(key, JSON.stringify(state))
}
