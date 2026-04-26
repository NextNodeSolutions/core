import { isRecord } from '#/config/types.ts'
import { HTTP_PRECONDITION_FAILED } from '#/domain/http/status.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type {
	HcloudConvergedState,
	HcloudCreatedState,
	HcloudProvisionedState,
	HcloudVpsState,
} from './types.ts'

const logger = createLogger()

const MAX_TRANSIENT_RETRIES = 3

/**
 * Signals that an R2 conditional PUT failed because the stored object's
 * ETag has moved on from the one the caller passed in `ifMatch`.
 *
 * Thrown instead of silently re-trying: another process has advanced the
 * state concurrently, so whatever the caller computed from the stale read
 * is already invalid. The correct recovery is to let the caller (or the
 * user re-running the pipeline) observe the fresh state and re-plan from
 * there — not to retry with the same outdated precondition.
 */
export class EtagMismatchError extends Error {
	constructor(vpsName: string, cause: unknown) {
		super(
			`State ETag mismatch for VPS "${vpsName}" — another process advanced state concurrently; re-run the pipeline to observe the latest state`,
			{ cause },
		)
		this.name = 'EtagMismatchError'
	}
}

function isEtagMismatch(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	if ('name' in error && error.name === 'PreconditionFailed') return true
	if (
		'$metadata' in error &&
		typeof error.$metadata === 'object' &&
		error.$metadata !== null &&
		'httpStatusCode' in error.$metadata &&
		error.$metadata.httpStatusCode === HTTP_PRECONDITION_FAILED
	) {
		return true
	}
	return false
}

export function stateKey(vpsName: string): string {
	return `hetzner/${vpsName}.json`
}

function requireBase(
	data: Record<string, unknown>,
	key: string,
): { serverId: number; publicIp: string } {
	if (typeof data.serverId !== 'number') {
		throw new Error(`Invalid state at "${key}": missing serverId`)
	}
	if (typeof data.publicIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing publicIp`)
	}
	return { serverId: data.serverId, publicIp: data.publicIp }
}

function parseCreated(
	data: Record<string, unknown>,
	key: string,
): HcloudCreatedState {
	return { phase: 'created', ...requireBase(data, key) }
}

function parseProvisioned(
	data: Record<string, unknown>,
	key: string,
): HcloudProvisionedState {
	const base = requireBase(data, key)
	if (typeof data.tailnetIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing tailnetIp`)
	}
	return { phase: 'provisioned', ...base, tailnetIp: data.tailnetIp }
}

function parseConverged(
	data: Record<string, unknown>,
	key: string,
): HcloudConvergedState {
	const base = requireBase(data, key)
	if (typeof data.tailnetIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing tailnetIp`)
	}
	if (typeof data.convergedAt !== 'string') {
		throw new Error(`Invalid state at "${key}": missing convergedAt`)
	}
	return {
		phase: 'converged',
		...base,
		tailnetIp: data.tailnetIp,
		convergedAt: data.convergedAt,
	}
}

function parseState(raw: string, key: string): HcloudVpsState {
	const data: unknown = JSON.parse(raw)
	if (!isRecord(data)) {
		throw new Error(`Invalid state at "${key}": not an object`)
	}
	const phase = data.phase
	if (phase === 'created') return parseCreated(data, key)
	if (phase === 'provisioned') return parseProvisioned(data, key)
	if (phase === 'converged') return parseConverged(data, key)
	throw new Error(
		`Invalid state at "${key}": unknown or missing phase "${String(phase)}"`,
	)
}

export interface StateWithEtag {
	readonly state: HcloudVpsState
	readonly etag: string
}

export async function readState(
	r2: ObjectStoreClient,
	vpsName: string,
): Promise<StateWithEtag | null> {
	const key = stateKey(vpsName)
	const result = await r2.get(key)
	if (!result) return null
	return { state: parseState(result.body, key), etag: result.etag }
}

export async function writeState(
	r2: ObjectStoreClient,
	vpsName: string,
	state: HcloudVpsState,
	ifMatch?: string,
): Promise<string> {
	const key = stateKey(vpsName)
	const body = JSON.stringify(state)
	let lastError: unknown

	for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
		try {
			return await r2.put(key, body, ifMatch) // eslint-disable-line no-await-in-loop -- sequential retries by design
		} catch (error) {
			if (isEtagMismatch(error)) {
				throw new EtagMismatchError(vpsName, error)
			}
			logger.warn(
				`writeState attempt ${attempt}/${MAX_TRANSIENT_RETRIES} failed for VPS "${vpsName}" (transient): ${String(error)}`,
			)
			lastError = error
		}
	}

	throw new Error(
		`writeState for VPS "${vpsName}" failed after ${MAX_TRANSIENT_RETRIES} transient retries`,
		{ cause: lastError },
	)
}

export async function deleteState(
	r2: ObjectStoreClient,
	vpsName: string,
): Promise<void> {
	await r2.delete(stateKey(vpsName))
}
