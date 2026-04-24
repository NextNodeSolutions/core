import {
	cloudflareGet,
	extractArrayResult,
	extractObjectResult,
} from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

// Cloudflare rejects per_page > 10 on /pages/projects with error 8000024
// ("Invalid list options provided"). Undocumented cap.
export const PAGES_PROJECTS_MAX_PER_PAGE = 10

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
	}
}

export interface ListPagesProjectsOptions {
	readonly client: CloudflareClient
	readonly perPage: number
	readonly page?: number
}

export const listPagesProjects = async ({
	client,
	perPage,
	page,
}: ListPagesProjectsOptions): Promise<
	ReadonlyArray<CloudflarePagesProject>
> => {
	const context = `Cloudflare Pages projects list for account ${client.accountId}`
	const data = await cloudflareGet(
		`/accounts/${client.accountId}/pages/projects`,
		client.token,
		context,
		{ per_page: perPage, page },
	)
	const result = extractArrayResult(data, context)
	return result.map((raw, index) =>
		parsePagesProject(raw, `Cloudflare Pages project[${String(index)}]`),
	)
}

export interface GetPagesProjectOptions {
	readonly client: CloudflareClient
	readonly projectName: string
}

export const getPagesProject = async ({
	client,
	projectName,
}: GetPagesProjectOptions): Promise<CloudflarePagesProject> => {
	const context = `Cloudflare Pages project "${projectName}"`
	const data = await cloudflareGet(
		`/accounts/${client.accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		client.token,
		context,
	)
	const result = extractObjectResult(data, context)
	return parsePagesProject(result, context)
}
