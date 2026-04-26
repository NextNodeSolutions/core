import type {
	DesiredDnsRecord,
	DnsRecordLookup,
} from '#/domain/cloudflare/dns-records.ts'
import { reconcileDnsRecord } from '#/domain/cloudflare/dns-records.ts'
import { createLogger } from '@nextnode-solutions/logger'

import {
	createDnsRecord,
	deleteDnsRecord,
	getZoneSslMode,
	listDnsRecords,
	lookupZoneId,
	setZoneSslMode,
	updateDnsRecord,
} from './api.ts'

const logger = createLogger()

export async function resolveAllZoneIds(
	records: ReadonlyArray<DnsRecordLookup>,
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

export async function applyDnsRecord(
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

const REQUIRED_SSL_MODE = 'strict'

async function ensureSslModeForProxiedZones(
	records: ReadonlyArray<DesiredDnsRecord>,
	zoneIds: Map<string, string>,
	token: string,
): Promise<void> {
	const proxiedZoneNames = [
		...new Set(records.filter(r => r.proxied).map(r => r.zoneName)),
	]

	await Promise.all(
		proxiedZoneNames.map(async zoneName => {
			const zoneId = zoneIds.get(zoneName)
			if (!zoneId) throw new Error(`Zone ID not resolved for ${zoneName}`)

			const current = await getZoneSslMode(zoneId, token)
			if (current === REQUIRED_SSL_MODE) return

			await setZoneSslMode(zoneId, REQUIRED_SSL_MODE, token)
			logger.info(
				`SSL mode for "${zoneName}" changed from "${current}" to "${REQUIRED_SSL_MODE}"`,
			)
		}),
	)
}

export async function reconcileDnsRecords(
	records: ReadonlyArray<DesiredDnsRecord>,
	token: string,
): Promise<void> {
	const zoneIds = await resolveAllZoneIds(records, token)

	await ensureSslModeForProxiedZones(records, zoneIds, token)

	await Promise.all(
		records.map(desired => {
			const zoneId = zoneIds.get(desired.zoneName)
			if (!zoneId) {
				throw new Error(`Zone ID not resolved for ${desired.zoneName}`)
			}
			return applyDnsRecord(zoneId, desired, token)
		}),
	)
}
