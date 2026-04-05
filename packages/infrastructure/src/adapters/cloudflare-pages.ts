import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	formatErrors,
	parseEnvelope,
	requireObjectResult,
	requireOk,
} from './cloudflare-api.js'

export interface CloudflarePagesProject {
	readonly name: string
	readonly productionBranch: string
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
	return {
		name: item.name,
		productionBranch: item.production_branch,
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
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		{ headers: authHeaders(token) },
	)
	if (response.status === 404) return null
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare Pages project lookup for "${projectName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return parsePagesProject(requireObjectResult(data, context))
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
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects`,
		{
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				name: projectName,
				production_branch: productionBranch,
			}),
		},
	)
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare Pages project create for "${projectName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return parsePagesProject(requireObjectResult(data, context))
}
