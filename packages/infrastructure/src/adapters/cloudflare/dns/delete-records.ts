import type { DnsRecordLookup } from '#/domain/cloudflare/dns-records.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { deleteDnsRecord, listDnsRecords } from './api.ts'
import { resolveAllZoneIds } from './reconcile.ts'

const logger = createLogger()

/**
 * Find and delete all DNS records matching the given desired record names.
 * Uses the record names and zone names from the desired set to look up
 * existing records, then deletes every match. Returns the total count
 * of records deleted.
 *
 * This is the teardown counterpart of `reconcileDnsRecords`. It accepts
 * `DnsRecordLookup[]` (just zoneName + name) so callers don't need to
 * provide content/type/ttl that are irrelevant for deletion.
 */
export async function deleteDnsRecordsByName(
	records: ReadonlyArray<DnsRecordLookup>,
	token: string,
): Promise<number> {
	if (records.length === 0) return 0

	const zoneIds = await resolveAllZoneIds(records, token)

	let deletedCount = 0

	await Promise.all(
		records.map(async desired => {
			const zoneId = zoneIds.get(desired.zoneName)
			if (!zoneId) {
				throw new Error(`Zone ID not resolved for ${desired.zoneName}`)
			}

			const existing = await listDnsRecords(zoneId, desired.name, token)
			if (existing.length === 0) return

			await Promise.all(
				existing.map(record =>
					deleteDnsRecord(zoneId, record.id, token),
				),
			)
			deletedCount += existing.length
			logger.info(
				`DNS deleted: ${desired.name} (${String(existing.length)} record(s))`,
			)
		}),
	)

	return deletedCount
}
