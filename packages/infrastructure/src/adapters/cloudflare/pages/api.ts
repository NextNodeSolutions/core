import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	cfFetchJson,
	formatErrors,
	parseEnvelope,
	requireArrayResult,
	requireObjectResult,
	requireOk,
} from '#/adapters/cloudflare/api.ts'
import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'

export interface CloudflarePagesProject {
	readonly name: string
	readonly productionBranch: string
	readonly subdomain: string
}

export interface CloudflarePagesDomain {
	readonly name: string
}

function parsePagesProject(item: unknown): CloudflarePagesProject {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare Pages project: item is not an object')
	}
	if (!('name' in item) || typeof item.name !== 'string') {
		throw new Error('Cloudflare Pages project: name missing')
	}
	if (
		!('production_branch' in item) ||
		typeof item.production_branch !== 'string'
	) {
		throw new Error('Cloudflare Pages project: production_branch missing')
	}
	if (!('subdomain' in item) || typeof item.subdomain !== 'string') {
		throw new Error('Cloudflare Pages project: subdomain missing')
	}
	return {
		name: item.name,
		productionBranch: item.production_branch,
		subdomain: item.subdomain,
	}
}

/**
 * Fetch a Cloudflare Pages project by name.
 * Returns `null` if the project does not exist (HTTP 404) — the API treats
 * a missing resource as a valid, expected state here. All other HTTP failures
 * propagate.
 */
export async function getPagesProject(
	accountId: string,
	projectName: string,
	token: string,
): Promise<CloudflarePagesProject | null> {
	// 404 is a valid "not found" state here, so we can't go through
	// cfFetchJson (which would route 404 into requireOk's throw). Inline
	// the envelope dance with the pre-fetched response.
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		{ headers: authHeaders(token) },
	)
	if (response.status === HTTP_NOT_FOUND) return null
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare Pages project lookup for "${projectName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return parsePagesProject(requireObjectResult(data, context))
}

function parsePagesDomain(item: unknown): CloudflarePagesDomain {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare Pages domain: item is not an object')
	}
	if (!('name' in item) || typeof item.name !== 'string') {
		throw new Error('Cloudflare Pages domain: name missing')
	}
	return { name: item.name }
}

/**
 * List the custom domains attached to a Cloudflare Pages project.
 *
 * The returned list reflects the domains tied to the project in the
 * "Custom domains" tab — NOT the DNS records in the zone. These are
 * separate concerns: attaching a domain here teaches Pages which
 * `Host` header maps to this project and provisions the SSL certificate.
 */
export async function listPagesDomains(
	accountId: string,
	projectName: string,
	token: string,
): Promise<ReadonlyArray<CloudflarePagesDomain>> {
	const context = `Cloudflare Pages domains list for "${projectName}"`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		token,
		context,
	)
	return requireArrayResult(data, context).map(parsePagesDomain)
}

/**
 * Attach a custom domain to a Cloudflare Pages project.
 *
 * Must be called BEFORE serving traffic from the domain — skipping this
 * step while only creating the CNAME record yields a 522 error because
 * the Pages edge has no routing entry for the incoming `Host` header.
 */
export async function attachPagesDomain(
	accountId: string,
	projectName: string,
	domainName: string,
	token: string,
): Promise<CloudflarePagesDomain> {
	const context = `Cloudflare Pages domain attach "${domainName}" to "${projectName}"`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		token,
		context,
		{ method: 'POST', body: JSON.stringify({ name: domainName }) },
	)
	return parsePagesDomain(requireObjectResult(data, context))
}

/**
 * Create a Cloudflare Pages project as a Direct Upload project with the
 * given production branch.
 */
export async function createPagesProject(
	accountId: string,
	projectName: string,
	productionBranch: string,
	token: string,
): Promise<CloudflarePagesProject> {
	const context = `Cloudflare Pages project create for "${projectName}"`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects`,
		token,
		context,
		{
			method: 'POST',
			body: JSON.stringify({
				name: projectName,
				production_branch: productionBranch,
			}),
		},
	)
	return parsePagesProject(requireObjectResult(data, context))
}

/**
 * Delete a Cloudflare Pages project. Returns `true` if the project was
 * deleted, `false` if it was already gone (404). All other HTTP errors
 * propagate - this is safe for idempotent teardown.
 */
export async function deletePagesProject(
	accountId: string,
	projectName: string,
	token: string,
): Promise<boolean> {
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		{
			method: 'DELETE',
			headers: authHeaders(token),
		},
	)
	if (response.status === HTTP_NOT_FOUND) return false
	await requireOk(response)
	return true
}
