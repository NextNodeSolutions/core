import { setTimeout as sleep } from 'node:timers/promises'

import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'
import { isRecord } from '#/kernel/guards.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'

const logger = createLogger()

export const PLANETSCALE_API_BASE = 'https://api.planetscale.com/v1'

// PlanetScale Postgres is the only engine this integration provisions; `kind`
// selects it (the API value is "postgresql", not "postgres").
const PLANETSCALE_KIND_POSTGRESQL = 'postgresql'

// A freshly created Postgres database takes a short while to become `ready`;
// Terraform's branch-role must not run before then. Bounded poll: 60 × 5s = 5m.
const READY_POLL_ATTEMPTS = 60
const READY_POLL_INTERVAL_MS = 5000
const MS_PER_SECOND = 1000

export interface EnsurePlanetscaleDatabaseInput {
	readonly organization: string
	readonly database: string
	readonly serviceTokenId: string
	readonly serviceToken: string
	readonly clusterSize?: string
	readonly region?: string
}

// Service-token auth is a colon-joined `id:token`, NOT a Bearer token (that form
// is for OAuth access tokens). Verbatim from the PlanetScale API reference.
function planetscaleHeaders(
	serviceTokenId: string,
	serviceToken: string,
): Record<string, string> {
	return {
		Authorization: `${serviceTokenId}:${serviceToken}`,
		'Content-Type': 'application/json',
	}
}

function databaseUrl(organization: string, database: string): string {
	return `${PLANETSCALE_API_BASE}/organizations/${organization}/databases/${database}`
}

function databasesUrl(organization: string): string {
	return `${PLANETSCALE_API_BASE}/organizations/${organization}/databases`
}

function isReady(body: unknown): boolean {
	return isRecord(body) && body['ready'] === true
}

async function throwOnError(
	response: Response,
	context: string,
): Promise<never> {
	const body = await response.text()
	throw new Error(
		`PlanetScale API returned ${String(response.status)} for ${context}: ${body}`,
	)
}

async function createDatabase(
	input: EnsurePlanetscaleDatabaseInput,
): Promise<void> {
	const { organization, database, clusterSize, region } = input
	logger.info(
		`Creating PlanetScale Postgres database "${database}" in organization "${organization}"`,
	)
	const response = await fetch(databasesUrl(organization), {
		method: 'POST',
		headers: planetscaleHeaders(input.serviceTokenId, input.serviceToken),
		body: JSON.stringify({
			name: database,
			kind: PLANETSCALE_KIND_POSTGRESQL,
			...(clusterSize && { cluster_size: clusterSize }),
			...(region && { region }),
		}),
	})
	if (!response.ok) {
		await throwOnError(response, `create database "${database}"`)
	}
}

/* eslint-disable no-await-in-loop -- sequential polling is intentional */
async function waitUntilReady(
	input: EnsurePlanetscaleDatabaseInput,
): Promise<void> {
	const { organization, database } = input
	const headers = planetscaleHeaders(input.serviceTokenId, input.serviceToken)
	for (let attempt = 1; attempt <= READY_POLL_ATTEMPTS; attempt++) {
		const response = await fetch(databaseUrl(organization, database), {
			headers,
		})
		if (!response.ok) {
			await throwOnError(
				response,
				`poll database "${database}" readiness`,
			)
		}
		const body: unknown = await response.json()
		if (isReady(body)) return
		await sleep(READY_POLL_INTERVAL_MS)
	}
	const timeoutSeconds =
		(READY_POLL_ATTEMPTS * READY_POLL_INTERVAL_MS) / MS_PER_SECOND
	throw new Error(
		`PlanetScale database "${database}" was not ready after ${String(
			READY_POLL_ATTEMPTS,
		)} attempts (${String(
			timeoutSeconds,
		)}s) - provisioning is stuck; check the PlanetScale dashboard.`,
	)
}
/* eslint-enable no-await-in-loop */

/**
 * Ensure the PlanetScale Postgres database backing a workers deploy exists and
 * is ready (create-if-absent), before Terraform creates the branch-role +
 * Hyperdrive config wired to it. Probes via GET (404 = not found, the create
 * branch point), creates it otherwise, then polls until `ready` so Terraform
 * never races an initialising database. The database is NOT a Terraform resource
 * (the PlanetScale provider has none) - this API step owns its existence, the
 * same split the HCP workspace uses.
 */
export async function ensurePlanetscaleDatabase(
	input: EnsurePlanetscaleDatabaseInput,
): Promise<ResourceOutcome> {
	const { organization, database } = input
	const headers = planetscaleHeaders(input.serviceTokenId, input.serviceToken)
	const context = `PlanetScale database "${database}"`

	const getResponse = await fetch(databaseUrl(organization, database), {
		headers,
	})

	if (getResponse.status === HTTP_NOT_FOUND) {
		await createDatabase(input)
		await waitUntilReady(input)
		logger.info(`${context} created and ready`)
		return { handled: true, detail: `created "${database}"` }
	}

	if (!getResponse.ok) {
		await throwOnError(getResponse, context)
	}

	if (!isReady(await getResponse.json())) {
		await waitUntilReady(input)
	}
	logger.info(`${context} already exists`)
	return { handled: false, detail: `existing "${database}"` }
}
