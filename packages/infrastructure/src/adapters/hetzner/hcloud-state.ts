import { createLogger } from '@nextnode-solutions/logger'

import { isRecord } from '../../config/types.ts'
import type { R2Operations } from '../r2/client.types.ts'

import type { HcloudProjectState } from './hcloud-state.types.ts'

const logger = createLogger()

const MAX_RETRIES = 3

function stateKey(projectName: string): string {
	return `hetzner/${projectName}.json`
}

function parseState(raw: string, key: string): HcloudProjectState {
	const data: unknown = JSON.parse(raw)
	if (!isRecord(data)) {
		throw new Error(`Invalid state at "${key}": not an object`)
	}
	if (typeof data.serverId !== 'number') {
		throw new Error(`Invalid state at "${key}": missing serverId`)
	}
	if (typeof data.publicIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing publicIp`)
	}
	if (typeof data.tailnetIp !== 'string') {
		throw new Error(`Invalid state at "${key}": missing tailnetIp`)
	}
	return {
		serverId: data.serverId,
		publicIp: data.publicIp,
		tailnetIp: data.tailnetIp,
	}
}

export interface StateWithEtag {
	readonly state: HcloudProjectState
	readonly etag: string
}

export async function readState(
	r2: R2Operations,
	projectName: string,
): Promise<StateWithEtag | null> {
	const key = stateKey(projectName)
	const result = await r2.get(key)
	if (!result) return null
	return { state: parseState(result.body, key), etag: result.etag }
}

export async function writeState(
	r2: R2Operations,
	projectName: string,
	state: HcloudProjectState,
	ifMatch?: string,
): Promise<string> {
	const key = stateKey(projectName)
	const body = JSON.stringify(state)
	let lastError: unknown

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await r2.put(key, body, ifMatch) // eslint-disable-line no-await-in-loop -- sequential retries by design
		} catch (error) {
			logger.warn(
				`writeState attempt ${attempt}/${MAX_RETRIES} failed for "${projectName}": ${String(error)}`,
			)
			lastError = error
		}
	}

	throw new Error(
		`State lock contention for "${projectName}" after ${MAX_RETRIES} attempts`,
		{ cause: lastError },
	)
}

export async function deleteState(
	r2: R2Operations,
	projectName: string,
): Promise<void> {
	await r2.delete(stateKey(projectName))
}
