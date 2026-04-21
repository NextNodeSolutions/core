import {
	cloudflareGet,
	extractArrayResult,
	extractObjectResult,
} from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

const parseDomains = (value: unknown): ReadonlyArray<string> => {
	if (!Array.isArray(value)) return []
	return value.filter((entry): entry is string => typeof entry === 'string')
}

const parsePagesProject = (
	raw: unknown,
	context: string,
): CloudflarePagesProject => {
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`name\``)
	}
	if (typeof raw.subdomain !== 'string') {
		throw new Error(`${context}: missing \`subdomain\``)
	}
	if (typeof raw.production_branch !== 'string') {
		throw new Error(`${context}: missing \`production_branch\``)
	}
	if (typeof raw.created_on !== 'string') {
		throw new Error(`${context}: missing \`created_on\``)
	}
	return {
		name: raw.name,
		subdomain: raw.subdomain,
		productionBranch: raw.production_branch,
		createdAt: raw.created_on,
		domains: parseDomains(raw.domains),
	}
}

/**
 * List every Cloudflare Pages project reachable by the given token within
 * the target account. Does not paginate — the Pages endpoint returns all
 * projects in a single page by default, and NextNode accounts hold a
 * handful of projects, not hundreds.
 */
export const listPagesProjects = async (
	accountId: string,
	token: string,
): Promise<ReadonlyArray<CloudflarePagesProject>> => {
	const context = `Cloudflare Pages projects list for account ${accountId}`
	const data = await cloudflareGet(
		`/accounts/${accountId}/pages/projects`,
		token,
		context,
	)
	const result = extractArrayResult(data, context)
	return result.map((raw, index) =>
		parsePagesProject(raw, `Cloudflare Pages project[${String(index)}]`),
	)
}

export const getPagesProject = async (
	accountId: string,
	token: string,
	projectName: string,
): Promise<CloudflarePagesProject> => {
	const context = `Cloudflare Pages project "${projectName}"`
	const data = await cloudflareGet(
		`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		token,
		context,
	)
	const result = extractObjectResult(data, context)
	return parsePagesProject(result, context)
}
