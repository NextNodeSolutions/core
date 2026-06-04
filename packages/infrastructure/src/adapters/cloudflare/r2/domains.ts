import {
	CLOUDFLARE_API_BASE,
	cfFetchJson,
	requireObjectResult,
} from '#/adapters/cloudflare/api.ts'

export interface EnsureR2CustomDomainInput {
	readonly token: string
	readonly accountId: string
	readonly bucketName: string
	readonly domain: string
	readonly zoneId: string
}

export interface R2CustomDomainStatus {
	readonly ownership: string
	readonly ssl: string
}

function customDomainsUrl(accountId: string, bucketName: string): string {
	return `${CLOUDFLARE_API_BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`
}

function parseDomainName(entry: unknown, context: string): string {
	if (
		typeof entry !== 'object' ||
		entry === null ||
		!('domain' in entry) ||
		typeof entry.domain !== 'string'
	) {
		throw new Error(
			`${context}: domain entry is missing a string \`domain\``,
		)
	}
	return entry.domain
}

/**
 * List the custom domains attached to an R2 bucket. Used as the idempotency
 * probe before attaching, mirroring `ensureR2Bucket`'s GET-before-POST.
 */
export async function listR2CustomDomains(
	token: string,
	accountId: string,
	bucketName: string,
): Promise<ReadonlyArray<string>> {
	const context = `Cloudflare R2 custom domains list for "${bucketName}"`
	const data = await cfFetchJson(
		customDomainsUrl(accountId, bucketName),
		token,
		context,
	)
	const result = requireObjectResult(data, context)
	if (!('domains' in result) || !Array.isArray(result.domains)) {
		throw new Error(`${context}: \`result.domains\` must be an array`)
	}
	return result.domains.map(entry => parseDomainName(entry, context))
}

/**
 * Ensure a custom domain is attached to an R2 bucket. Idempotent: probes via
 * the list endpoint and returns early when the domain is already present.
 * Passing `zoneId` lets Cloudflare auto-create the proxied CNAME in the
 * same-account zone, so no separate DNS write is needed.
 *
 * Returns `true` if the domain was newly attached, `false` if it already
 * existed — callers use this for logging.
 */
export async function ensureR2CustomDomain(
	input: EnsureR2CustomDomainInput,
): Promise<boolean> {
	const existing = await listR2CustomDomains(
		input.token,
		input.accountId,
		input.bucketName,
	)
	if (existing.includes(input.domain)) return false

	const context = `Cloudflare R2 custom domain attach "${input.domain}" to "${input.bucketName}"`
	await cfFetchJson(
		customDomainsUrl(input.accountId, input.bucketName),
		input.token,
		context,
		{
			method: 'POST',
			body: JSON.stringify({
				domain: input.domain,
				zoneId: input.zoneId,
				enabled: true,
			}),
		},
	)
	return true
}

function parseStatus(result: object, context: string): R2CustomDomainStatus {
	if (
		!('status' in result) ||
		typeof result.status !== 'object' ||
		result.status === null
	) {
		throw new Error(`${context}: missing \`status\` object`)
	}
	const status = result.status
	const ownership =
		'ownership' in status && typeof status.ownership === 'string'
			? status.ownership
			: ''
	const ssl =
		'ssl' in status && typeof status.ssl === 'string' ? status.ssl : ''
	if (ownership === '' || ssl === '') {
		throw new Error(`${context}: \`status\` missing ownership/ssl strings`)
	}
	return { ownership, ssl }
}

/**
 * Read the provisioning status of an attached custom domain. Ownership +
 * SSL move from `pending`/`initializing` to `active` over a few minutes
 * after attach — callers poll this until `ssl === "active"`.
 */
export async function getR2CustomDomainStatus(
	token: string,
	accountId: string,
	bucketName: string,
	domain: string,
): Promise<R2CustomDomainStatus> {
	const context = `Cloudflare R2 custom domain status for "${domain}"`
	const data = await cfFetchJson(
		`${customDomainsUrl(accountId, bucketName)}/${encodeURIComponent(domain)}`,
		token,
		context,
	)
	return parseStatus(requireObjectResult(data, context), context)
}

/**
 * Detach a custom domain from an R2 bucket. Cloudflare removes the
 * auto-created CNAME as part of the detach. Used at teardown.
 */
export async function deleteR2CustomDomain(
	token: string,
	accountId: string,
	bucketName: string,
	domain: string,
): Promise<void> {
	const context = `Cloudflare R2 custom domain delete "${domain}"`
	await cfFetchJson(
		`${customDomainsUrl(accountId, bucketName)}/${encodeURIComponent(domain)}`,
		token,
		context,
		{ method: 'DELETE' },
	)
}
