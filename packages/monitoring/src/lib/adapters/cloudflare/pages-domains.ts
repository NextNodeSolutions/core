import {
	cloudflareGet,
	extractArrayResult,
} from '@/lib/adapters/cloudflare/client.ts'
import type {
	CloudflarePagesDomain,
	CloudflarePagesDomainStatus,
} from '@/lib/domain/cloudflare/pages-domain.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

const DOMAIN_STATUSES: ReadonlyArray<CloudflarePagesDomainStatus> = [
	'active',
	'pending',
	'canceled',
	'error',
	'unknown',
]

const parseStatus = (value: unknown): CloudflarePagesDomainStatus => {
	if (typeof value !== 'string') return 'unknown'
	return DOMAIN_STATUSES.find(status => status === value) ?? 'unknown'
}

const parseStringOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null

const parseVerificationData = (value: unknown): string | null => {
	if (!isRecord(value)) return null
	return parseStringOrNull(value.error_message)
}

const parsePagesDomain = (
	raw: unknown,
	index: number,
): CloudflarePagesDomain => {
	const context = `Cloudflare Pages domain[${String(index)}]`
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`name\``)
	}
	if (typeof raw.created_on !== 'string') {
		throw new Error(`${context}: missing \`created_on\``)
	}
	return {
		name: raw.name,
		status: parseStatus(raw.status),
		verificationData: parseVerificationData(raw.validation_data),
		certificateAuthority: parseStringOrNull(raw.certificate_authority),
		createdAt: raw.created_on,
	}
}

export const listPagesDomains = async (
	accountId: string,
	token: string,
	projectName: string,
): Promise<ReadonlyArray<CloudflarePagesDomain>> => {
	const context = `Cloudflare Pages domains for "${projectName}"`
	const data = await cloudflareGet(
		`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		token,
		context,
	)
	const result = extractArrayResult(data, context)
	return result.map(parsePagesDomain)
}
