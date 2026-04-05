import { logger } from '@nextnode-solutions/logger'

import {
	createDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from '../adapters/cloudflare-dns.js'
import type {
	CloudflareDnsRecord,
	DnsRecordPayload,
} from '../adapters/cloudflare-dns.js'
import { loadConfig } from '../config/load.js'
import type { ProjectSection } from '../config/schema.js'
import type {
	DesiredDnsRecord,
	ExistingDnsRecord,
} from '../domain/dns-records.js'
import { computeDnsRecords, reconcileDnsRecord } from '../domain/dns-records.js'
import type { AppEnvironment } from '../domain/environment.js'
import { resolveEnvironment } from '../domain/environment.js'

import { getEnv, requireEnv } from './env.js'

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
		projectName: config.project.name,
	})

	logger.info(
		`Reconciling ${records.length} DNS record(s) for ${config.project.domain} (${environment})`,
	)

	const zoneIdCache = new Map<string, string>()
	for (const desired of records) {
		const zoneId = await resolveZoneId(desired.zoneName, token, zoneIdCache)
		await applyRecord(zoneId, desired, token)
	}

	logger.info('DNS reconciliation complete')
}

async function resolveZoneId(
	zoneName: string,
	token: string,
	cache: Map<string, string>,
): Promise<string> {
	const cached = cache.get(zoneName)
	if (cached) return cached
	const zoneId = await lookupZoneId(zoneName, token)
	cache.set(zoneName, zoneId)
	return zoneId
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
