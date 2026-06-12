import { HTTP_PRECONDITION_FAILED } from '#/domain/http/status.ts'
import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
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
 * there - not to retry with the same outdated precondition.
 */
export class EtagMismatchError extends Error {
	constructor(vpsName: string, cause: unknown) {
		super(
			`State ETag mismatch for VPS "${vpsName}" - another process advanced state concurrently; re-run the pipeline to observe the latest state`,
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

// An ETag mismatch is a lost compare-and-swap (concurrent writer), not a
// transient fault - surface it as EtagMismatchError so the retry loop stops.
function rethrowIfEtagMismatch(error: unknown, vpsName: string): void {
	if (isEtagMismatch(error)) {
		throw new EtagMismatchError(vpsName, error)
	}
}

export function stateKey(vpsName: string): string {
	return `hetzner/${vpsName}.json`
}

function requireBase(
	stateRecord: Record<string, unknown>,
	key: string,
): { serverId: number; publicIp: string } {
	if (typeof stateRecord.serverId !== 'number') {
		throw new Error(`Invalid state at "${key}": missing serverId`)
	}
	if (typeof stateRecord.publicIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing publicIp`)
	}
	return { serverId: stateRecord.serverId, publicIp: stateRecord.publicIp }
}

function parseHostPorts(
	stateRecord: Record<string, unknown>,
	key: string,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
	const raw = stateRecord.hostPorts
	if (raw === undefined) return {}
	if (!isRecord(raw)) {
		throw new Error(
			`Invalid state at "${key}": hostPorts must be an object`,
		)
	}
	const portsByProject: Record<string, Record<string, number>> = {}
	for (const [project, servicePorts] of Object.entries(raw)) {
		portsByProject[project] = parseServicePorts(servicePorts, project, key)
	}
	return portsByProject
}

function parseServicePorts(
	raw: unknown,
	project: string,
	key: string,
): Record<string, number> {
	if (!isRecord(raw)) {
		throw new Error(
			`Invalid state at "${key}": hostPorts.${project} must be an object`,
		)
	}
	const ports: Record<string, number> = {}
	for (const [service, port] of Object.entries(raw)) {
		if (typeof port !== 'number' || !Number.isInteger(port)) {
			throw new Error(
				`Invalid state at "${key}": hostPorts.${project}.${service} must be an integer`,
			)
		}
		ports[service] = port
	}
	return ports
}

function parseCreated(
	stateRecord: Record<string, unknown>,
	key: string,
): HcloudCreatedState {
	return {
		phase: 'created',
		...requireBase(stateRecord, key),
		hostPorts: parseHostPorts(stateRecord, key),
	}
}

function parseProvisioned(
	stateRecord: Record<string, unknown>,
	key: string,
): HcloudProvisionedState {
	const base = requireBase(stateRecord, key)
	if (typeof stateRecord.tailnetIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing tailnetIp`)
	}
	return {
		phase: 'provisioned',
		...base,
		tailnetIp: stateRecord.tailnetIp,
		hostPorts: parseHostPorts(stateRecord, key),
	}
}

function parseConverged(
	stateRecord: Record<string, unknown>,
	key: string,
): HcloudConvergedState {
	const base = requireBase(stateRecord, key)
	if (typeof stateRecord.tailnetIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing tailnetIp`)
	}
	if (typeof stateRecord.convergedAt !== 'string') {
		throw new Error(`Invalid state at "${key}": missing convergedAt`)
	}
	return {
		phase: 'converged',
		...base,
		tailnetIp: stateRecord.tailnetIp,
		convergedAt: stateRecord.convergedAt,
		hostPorts: parseHostPorts(stateRecord, key),
	}
}

function parseState(raw: string, key: string): HcloudVpsState {
	const stateRecord: unknown = parseJsonOrThrow(
		raw,
		`Invalid state at "${key}"`,
	)
	if (!isRecord(stateRecord)) {
		throw new Error(`Invalid state at "${key}": not an object`)
	}
	const { phase } = stateRecord
	if (phase === 'created') return parseCreated(stateRecord, key)
	if (phase === 'provisioned') return parseProvisioned(stateRecord, key)
	if (phase === 'converged') return parseConverged(stateRecord, key)
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
	const stored = await r2.get(key)
	if (!stored) return null
	return { state: parseState(stored.body, key), etag: stored.etag }
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
			rethrowIfEtagMismatch(error, vpsName)
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
