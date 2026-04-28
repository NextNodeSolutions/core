import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { apiGet, extractArrayResult } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import {
	parseCloudflarePagesDeploymentEnvironment,
	parseCloudflarePagesDeploymentStatus,
	SHORT_ID_LENGTH,
} from '@/lib/domain/cloudflare/pages-deployment.ts'
import type {
	CloudflarePagesDeployment,
	CloudflarePagesDeploymentStatus,
} from '@/lib/domain/cloudflare/pages-deployment.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import {
	parseStringArray,
	parseStringOrNull,
} from '@/lib/domain/parse-string.ts'

const parseTrigger = (value: unknown): string | null => {
	if (!isRecord(value)) return null
	const type = typeof value.type === 'string' ? value.type : null
	if (!isRecord(value.metadata)) return type
	const triggerName =
		typeof value.metadata.trigger_name === 'string'
			? value.metadata.trigger_name
			: null
	return triggerName ?? type
}

interface CommitMeta {
	readonly branch: string | null
	readonly commitHash: string | null
	readonly commitMessage: string | null
	readonly author: string | null
}

const EMPTY_COMMIT_META: CommitMeta = {
	branch: null,
	commitHash: null,
	commitMessage: null,
	author: null,
}

const parseCommitMeta = (value: unknown): CommitMeta => {
	if (!isRecord(value) || !isRecord(value.metadata)) return EMPTY_COMMIT_META
	const meta = value.metadata
	return {
		branch: parseStringOrNull(meta.branch),
		commitHash: parseStringOrNull(meta.commit_hash),
		commitMessage: parseStringOrNull(meta.commit_message),
		author: parseStringOrNull(meta.commit_author),
	}
}

const parseLatestStage = (value: unknown): string | null => {
	if (!isRecord(value)) return null
	return parseStringOrNull(value.name)
}

const parsePagesDeployment = (
	raw: unknown,
	index: number,
): CloudflarePagesDeployment => {
	const context = `Cloudflare Pages deployment[${String(index)}]`
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.id !== 'string') {
		throw new Error(`${context}: missing \`id\``)
	}
	if (typeof raw.created_on !== 'string') {
		throw new Error(`${context}: missing \`created_on\``)
	}
	if (typeof raw.modified_on !== 'string') {
		throw new Error(`${context}: missing \`modified_on\``)
	}
	const commit = parseCommitMeta(raw.deployment_trigger)
	const stageName = parseLatestStage(raw.latest_stage)
	const baseStatus = parseCloudflarePagesDeploymentStatus(
		isRecord(raw.latest_stage) ? raw.latest_stage.status : undefined,
	)
	const isSkipped = raw.is_skipped === true
	const status: CloudflarePagesDeploymentStatus = isSkipped
		? 'skipped'
		: baseStatus
	return {
		id: raw.id,
		shortId:
			typeof raw.short_id === 'string' && raw.short_id.length > 0
				? raw.short_id
				: raw.id.slice(0, SHORT_ID_LENGTH),
		environment: parseCloudflarePagesDeploymentEnvironment(raw.environment),
		url: parseStringOrNull(raw.url),
		branch: commit.branch,
		commitHash: commit.commitHash,
		commitMessage: commit.commitMessage,
		author: commit.author,
		trigger: parseTrigger(raw.deployment_trigger),
		createdAt: raw.created_on,
		modifiedAt: raw.modified_on,
		status,
		stageName,
		isSkipped,
		aliases: parseStringArray(raw.aliases),
	}
}

export interface ListPagesDeploymentsOptions {
	readonly client: CloudflareClient
	readonly projectName: string
	readonly limit: number
}

// Deployments are the most dynamic CF data — a build can finish during the
// dashboard session. Keep TTL short so refreshing the page surfaces new
// deployments quickly while still collapsing duplicate concurrent renders.
const PAGES_DEPLOYMENTS_TTL_MS = 15_000

// Cloudflare returns deployments newest-first; the dashboard only ever needs a
// bounded "recent deployments" slice, so this fetches page 1 with `per_page =
// limit` rather than auto-paginating the full history.
const fetchPagesDeployments = async ({
	client,
	projectName,
	limit,
}: ListPagesDeploymentsOptions): Promise<
	ReadonlyArray<CloudflarePagesDeployment>
> => {
	const context = `Cloudflare Pages deployments for "${projectName}"`
	const data = await apiGet(
		`/accounts/${client.accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
		client.token,
		context,
		{ per_page: limit },
	)
	const result = extractArrayResult(data, context)
	return result.map(parsePagesDeployment)
}

const memoizedListPagesDeployments = keyedMemoizeAsync(
	PAGES_DEPLOYMENTS_TTL_MS,
	({ client, projectName, limit }: ListPagesDeploymentsOptions) =>
		`${client.accountId} ${projectName} ${String(limit)}`,
	fetchPagesDeployments,
)

export const listPagesDeployments = (
	options: ListPagesDeploymentsOptions,
): Promise<ReadonlyArray<CloudflarePagesDeployment>> =>
	memoizedListPagesDeployments(options)
