import { createLogger } from '@nextnode-solutions/logger'

import type { DesiredDnsRecord } from '../../domain/deploy/dns-records.ts'
import {
	computeDnsRecords,
	reconcileDnsRecord,
} from '../../domain/deploy/dns-records.ts'
import type { AppEnvironment } from '../../domain/environment.ts'

import {
	createDnsRecord,
	deleteDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from './dns.ts'

const logger = createLogger()

export interface ReconcileDnsInput {
	readonly accountId: string
	readonly pagesProjectName: string
	readonly token: string
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
}

export async function reconcileDns(input: ReconcileDnsInput): Promise<void> {
	const records = computeDnsRecords({
		domain: input.domain,
		redirectDomains: input.redirectDomains,
		environment: input.environment,
		projectName: input.pagesProjectName,
	})

	const zoneIds = await resolveAllZoneIds(records, input.token)

	await Promise.all(
		records.map(desired => {
			const zoneId = zoneIds.get(desired.zoneName)
			if (!zoneId) {
				throw new Error(`Zone ID not resolved for ${desired.zoneName}`)
			}
			return applyDnsRecord(zoneId, desired, input.token)
		}),
	)
}

async function resolveAllZoneIds(
	records: ReadonlyArray<DesiredDnsRecord>,
	token: string,
): Promise<Map<string, string>> {
	const uniqueZones = [...new Set(records.map(r => r.zoneName))]
	const entries = await Promise.all(
		uniqueZones.map(
			async (zone): Promise<[string, string]> => [
				zone,
				await lookupZoneId(zone, token),
			],
		),
	)
	return new Map(entries)
}

async function applyDnsRecord(
	zoneId: string,
	desired: DesiredDnsRecord,
	token: string,
): Promise<void> {
	const existing = await listDnsRecords(zoneId, desired.name, token)

	const action = reconcileDnsRecord(desired, existing)
	const proxiedLabel = desired.proxied ? 'proxied' : 'unproxied'

	if (action.kind === 'skip') {
		logger.info(`DNS "${desired.name}" already correct (${proxiedLabel})`)
		return
	}
	if (action.kind === 'create') {
		await createDnsRecord(zoneId, desired, token)
		logger.info(`DNS created: ${desired.name} (${proxiedLabel})`)
		return
	}
	if (action.kind === 'replace') {
		await Promise.all(
			action.deleteRecordIds.map(id =>
				deleteDnsRecord(zoneId, id, token),
			),
		)
		await createDnsRecord(zoneId, desired, token)
		logger.info(`DNS replaced: ${desired.name} (${proxiedLabel})`)
		return
	}
	await updateDnsRecord(zoneId, action.recordId, desired, token)
	logger.info(`DNS updated: ${desired.name} (${proxiedLabel})`)
}
