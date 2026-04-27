import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	apiGet,
	extractObjectResult,
	listAll,
} from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

// Cloudflare rejects per_page > 10 on /pages/projects with error 8000024
// ("Invalid list options provided"). Undocumented cap — used as the chunk size
// for auto-pagination.
const PAGES_PROJECTS_MAX_PER_PAGE = 10

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

// Pages project lists rarely change (creation/deletion are infrequent).
const PAGES_PROJECTS_TTL_MS = 60_000
const PAGES_PROJECT_TTL_MS = 60_000

export interface ListPagesProjectsOptions {
	readonly client: CloudflareClient
}

const fetchPagesProjects = async ({
	client,
}: ListPagesProjectsOptions): Promise<
	ReadonlyArray<CloudflarePagesProject>
> => {
	const context = `Cloudflare Pages projects list for account ${client.accountId}`
	const raw = await listAll(
		`/accounts/${client.accountId}/pages/projects`,
		client.token,
		context,
		PAGES_PROJECTS_MAX_PER_PAGE,
	)
	return raw.map((item, index) =>
		parsePagesProject(item, `Cloudflare Pages project[${String(index)}]`),
	)
}

const memoizedListPagesProjects = keyedMemoizeAsync(
	PAGES_PROJECTS_TTL_MS,
	({ client }: ListPagesProjectsOptions) => client.accountId,
	fetchPagesProjects,
)

export const listPagesProjects = (
	options: ListPagesProjectsOptions,
): Promise<ReadonlyArray<CloudflarePagesProject>> =>
	memoizedListPagesProjects(options)

export interface GetPagesProjectOptions {
	readonly client: CloudflareClient
	readonly projectName: string
}

const fetchPagesProject = async ({
	client,
	projectName,
}: GetPagesProjectOptions): Promise<CloudflarePagesProject> => {
	const context = `Cloudflare Pages project "${projectName}"`
	const data = await apiGet(
		`/accounts/${client.accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		client.token,
		context,
	)
	const result = extractObjectResult(data, context)
	return parsePagesProject(result, context)
}

const memoizedGetPagesProject = keyedMemoizeAsync(
	PAGES_PROJECT_TTL_MS,
	({ client, projectName }: GetPagesProjectOptions) =>
		`${client.accountId} ${projectName}`,
	fetchPagesProject,
)

export const getPagesProject = (
	options: GetPagesProjectOptions,
): Promise<CloudflarePagesProject> => memoizedGetPagesProject(options)
