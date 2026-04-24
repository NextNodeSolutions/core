import {
	cloudflareGet,
	extractArrayResult,
} from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { parseCloudflarePagesDomainStatus } from '@/lib/domain/cloudflare/pages-domain.ts'
import type { CloudflarePagesDomain } from '@/lib/domain/cloudflare/pages-domain.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

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
		status: parseCloudflarePagesDomainStatus(raw.status),
		verificationData: parseVerificationData(raw.validation_data),
		certificateAuthority: parseStringOrNull(raw.certificate_authority),
		createdAt: raw.created_on,
	}
}

export interface ListPagesDomainsOptions {
	readonly client: CloudflareClient
	readonly projectName: string
	readonly perPage: number
	readonly page?: number
}

export const listPagesDomains = async ({
	client,
	projectName,
	perPage,
	page,
}: ListPagesDomainsOptions): Promise<ReadonlyArray<CloudflarePagesDomain>> => {
	const context = `Cloudflare Pages domains for "${projectName}"`
	const data = await cloudflareGet(
		`/accounts/${client.accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		client.token,
		context,
		{ per_page: perPage, page },
	)
	const result = extractArrayResult(data, context)
	return result.map(parsePagesDomain)
}
