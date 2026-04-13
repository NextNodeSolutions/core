import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import {
	createDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from '../adapters/cloudflare-dns.ts'
import type {
	CloudflareDnsRecord,
	DnsRecordPayload,
} from '../adapters/cloudflare-dns.ts'
import { loadConfig } from '../config/load.ts'
import type { ProjectSection } from '../config/types.ts'
import type {
	DesiredDnsRecord,
	ExistingDnsRecord,
} from '../domain/dns-records.ts'
import { computeDnsRecords, reconcileDnsRecord } from '../domain/dns-records.ts'
import type { AppEnvironment } from '../domain/environment.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'

import { getEnv, requireEnv } from './env.ts'

export async function dnsCommand(): Promise<void> {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)

	if (!config.project.domain) {
		logger.info(
			'No project.domain configured in nextnode.toml — skipping DNS reconciliation',
		)
		return
	}

	const environment = resolveAppEnvironmentForDns(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const token = requireEnv('CLOUDFLARE_API_TOKEN')

	const records = computeDnsRecords({
		domain: config.project.domain,
		redirectDomains: config.project.redirectDomains,
		environment,
		projectName: computePagesProjectName(config.project.name, environment),
	})

	logger.info(
		`Reconciling ${records.length} DNS record(s) for ${config.project.domain} (${environment})`,
	)

	const zoneIds = await resolveAllZoneIds(records, token)
	await Promise.all(
		records.map(desired => {
			const zoneId = zoneIds.get(desired.zoneName)
			if (!zoneId) {
				throw new Error(`Zone ID not resolved for ${desired.zoneName}`)
			}
			return applyRecord(zoneId, desired, token)
		}),
	)

	logger.info('DNS reconciliation complete')
}

async function resolveAllZoneIds(
	records: ReadonlyArray<DesiredDnsRecord>,
	token: string,
): Promise<Map<string, string>> {
	const uniqueZones = [...new Set(records.map(record => record.zoneName))]
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

async function applyRecord(
	zoneId: string,
	desired: DesiredDnsRecord,
	token: string,
): Promise<void> {
	const existing = await listDnsRecords(
		zoneId,
		desired.name,
		desired.type,
		token,
	)
	const action = reconcileDnsRecord(desired, existing.map(toExistingRecord))

	const payload: DnsRecordPayload = {
		type: desired.type,
		name: desired.name,
		content: desired.content,
		proxied: desired.proxied,
		ttl: desired.ttl,
	}
	const proxiedLabel = desired.proxied ? 'proxied' : 'unproxied'

	if (action.kind === 'skip') {
		logger.info(
			`Skip: ${desired.name} -> ${desired.content} (${proxiedLabel}) already correct`,
		)
		return
	}
	if (action.kind === 'create') {
		await createDnsRecord(zoneId, payload, token)
		logger.info(
			`Created: ${desired.name} -> ${desired.content} (${proxiedLabel})`,
		)
		return
	}
	await updateDnsRecord(zoneId, action.recordId, payload, token)
	logger.info(
		`Updated: ${desired.name} -> ${desired.content} (${proxiedLabel})`,
	)
}

function toExistingRecord(record: CloudflareDnsRecord): ExistingDnsRecord {
	return {
		id: record.id,
		content: record.content,
		proxied: record.proxied,
		ttl: record.ttl,
	}
}

function resolveAppEnvironmentForDns(
	projectType: ProjectSection['type'],
	rawEnv: string | undefined,
): AppEnvironment {
	const resolved = resolveEnvironment(projectType, rawEnv)
	if (resolved === 'none') {
		throw new Error(
			'DNS reconciliation is not supported for package projects',
		)
	}
	return resolved
}
