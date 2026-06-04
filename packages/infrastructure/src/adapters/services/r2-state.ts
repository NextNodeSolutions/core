import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

import type { R2BucketBinding, R2ServiceState } from '#/domain/services/r2.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'

function parseBucketBindings(
	value: unknown,
	key: string,
): ReadonlyArray<R2BucketBinding> {
	if (!Array.isArray(value)) {
		throw new Error(
			`Invalid R2 service state at "${key}": buckets is not an array`,
		)
	}
	return value.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new Error(
				`Invalid R2 service state at "${key}": buckets[${String(index)}] is not an object`,
			)
		}
		const alias = entry['alias']
		const name = entry['name']
		if (typeof alias !== 'string' || alias === '') {
			throw new Error(
				`Invalid R2 service state at "${key}": buckets[${String(index)}].alias missing`,
			)
		}
		if (typeof name !== 'string' || name === '') {
			throw new Error(
				`Invalid R2 service state at "${key}": buckets[${String(index)}].name missing`,
			)
		}
		const publicUrl = entry['publicUrl']
		if (publicUrl === undefined) return { alias, name }
		if (typeof publicUrl !== 'string' || publicUrl === '') {
			throw new Error(
				`Invalid R2 service state at "${key}": buckets[${String(index)}].publicUrl must be a non-empty string when present`,
			)
		}
		return { alias, name, publicUrl }
	})
}

function parseState(raw: string, key: string): R2ServiceState {
	const data: unknown = parseJsonOrThrow(
		raw,
		`Invalid R2 service state at "${key}"`,
	)
	if (!isRecord(data)) {
		throw new Error(`Invalid R2 service state at "${key}": not an object`)
	}
	const endpoint = data['endpoint']
	const accessKeyId = data['accessKeyId']
	const secretAccessKey = data['secretAccessKey']
	if (typeof endpoint !== 'string' || endpoint === '') {
		throw new Error(
			`Invalid R2 service state at "${key}": missing endpoint`,
		)
	}
	if (typeof accessKeyId !== 'string' || accessKeyId === '') {
		throw new Error(
			`Invalid R2 service state at "${key}": missing accessKeyId`,
		)
	}
	if (typeof secretAccessKey !== 'string' || secretAccessKey === '') {
		throw new Error(
			`Invalid R2 service state at "${key}": missing secretAccessKey`,
		)
	}
	return {
		endpoint,
		accessKeyId,
		secretAccessKey,
		buckets: parseBucketBindings(data['buckets'], key),
	}
}

export async function readR2ServiceState(
	r2: ObjectStoreClient,
	key: string,
): Promise<R2ServiceState | null> {
	const result = await r2.get(key)
	if (!result) return null
	return parseState(result.body, key)
}

export async function writeR2ServiceState(
	r2: ObjectStoreClient,
	key: string,
	state: R2ServiceState,
): Promise<void> {
	await r2.put(key, JSON.stringify(state))
}
