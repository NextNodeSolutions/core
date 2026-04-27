import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { listAll } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { parseCloudflarePagesDomainStatus } from '@/lib/domain/cloudflare/pages-domain.ts'
import type { CloudflarePagesDomain } from '@/lib/domain/cloudflare/pages-domain.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

// Cloudflare rejects per_page > 25 on /pages/projects/:name/domains with error
// 8000024 ("Invalid list options provided"). Undocumented cap — used as the
// chunk size for auto-pagination.
const PAGES_DOMAINS_MAX_PER_PAGE = 25

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
}

// Pages custom domains don't churn within a minute under normal operation.
const PAGES_DOMAINS_TTL_MS = 60_000

const fetchPagesDomains = async ({
	client,
	projectName,
}: ListPagesDomainsOptions): Promise<ReadonlyArray<CloudflarePagesDomain>> => {
	const context = `Cloudflare Pages domains for "${projectName}"`
	const raw = await listAll(
		`/accounts/${client.accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		client.token,
		context,
		PAGES_DOMAINS_MAX_PER_PAGE,
	)
	return raw.map(parsePagesDomain)
}

const memoizedListPagesDomains = keyedMemoizeAsync(
	PAGES_DOMAINS_TTL_MS,
	({ client, projectName }: ListPagesDomainsOptions) =>
		`${client.accountId} ${projectName}`,
	fetchPagesDomains,
)

export const listPagesDomains = (
	options: ListPagesDomainsOptions,
): Promise<ReadonlyArray<CloudflarePagesDomain>> =>
	memoizedListPagesDomains(options)
