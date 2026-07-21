import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	GithubApiFailure,
	GithubMalformedResponseError,
	githubGet,
} from '@/lib/adapters/github/client.ts'
import { mapWithConcurrency } from '@/lib/domain/concurrency.ts'
import { referencesReusableDeployWorkflow } from '@/lib/domain/github/deploy-workflow.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

import type { DeployWorkflow } from '@/lib/domain/github/deploy-workflow.ts'

/**
 * Which of a repo's workflows are VPS deploy pipelines (callers of the
 * reusable deploy.yml). Detection needs each workflow's YAML, so this costs
 * one contents fetch per active workflow on a cold cache - hence the long
 * TTL: a repo's workflow set only changes when its CI is edited.
 */

const DEPLOY_WORKFLOWS_TTL_MS = 900_000
const WORKFLOWS_PER_PAGE = 100
const CONTENT_CONCURRENCY = 4
const HTTP_NOT_FOUND = 404

interface WorkflowListing {
	readonly id: number
	readonly name: string
	readonly path: string
	readonly state: string
}

const parseWorkflowListing = (raw: unknown): WorkflowListing | null => {
	if (!isRecord(raw)) return null
	if (
		typeof raw.id !== 'number' ||
		typeof raw.name !== 'string' ||
		typeof raw.path !== 'string' ||
		typeof raw.state !== 'string'
	) {
		return null
	}
	return { id: raw.id, name: raw.name, path: raw.path, state: raw.state }
}

const listActiveWorkflows = async (
	token: string,
	fullName: string,
): Promise<ReadonlyArray<WorkflowListing>> => {
	const context = `GitHub workflows for "${fullName}"`
	const payload = await githubGet(
		`/repos/${fullName}/actions/workflows?per_page=${String(WORKFLOWS_PER_PAGE)}`,
		token,
		context,
	)
	if (!isRecord(payload) || !Array.isArray(payload.workflows)) {
		throw new GithubMalformedResponseError(
			context,
			'expected a `workflows` array',
		)
	}
	return payload.workflows
		.map(parseWorkflowListing)
		.filter(
			(workflow): workflow is WorkflowListing =>
				workflow?.state === 'active',
		)
}

/**
 * The workflow file's decoded text, or null when the listing is stale and the
 * path is gone (a 404 here is a known GitHub state after a workflow file is
 * renamed - the runs history keeps the old entry alive, so it is "skip this
 * workflow", not an upstream outage).
 */
const fetchWorkflowFileText = async (
	token: string,
	fullName: string,
	path: string,
): Promise<string | null> => {
	const context = `GitHub workflow file "${fullName}/${path}"`
	let payload: unknown
	try {
		payload = await githubGet(
			`/repos/${fullName}/contents/${path}`,
			token,
			context,
		)
	} catch (error) {
		if (
			error instanceof GithubApiFailure &&
			error.httpStatus === HTTP_NOT_FOUND
		) {
			return null
		}
		throw error
	}
	if (
		!isRecord(payload) ||
		typeof payload.content !== 'string' ||
		payload.encoding !== 'base64'
	) {
		throw new GithubMalformedResponseError(
			context,
			'expected a base64 `content` field',
		)
	}
	return Buffer.from(payload.content, 'base64').toString('utf8')
}

const fetchDeployWorkflows = async (input: {
	readonly token: string
	readonly fullName: string
}): Promise<ReadonlyArray<DeployWorkflow>> => {
	const workflows = await listActiveWorkflows(input.token, input.fullName)
	const flagged = await mapWithConcurrency(
		workflows,
		CONTENT_CONCURRENCY,
		async workflow => {
			const text = await fetchWorkflowFileText(
				input.token,
				input.fullName,
				workflow.path,
			)
			if (text !== null && referencesReusableDeployWorkflow(text)) {
				return {
					id: workflow.id,
					name: workflow.name,
					path: workflow.path,
				}
			}
			return null
		},
	)
	return flagged.filter(
		(workflow): workflow is DeployWorkflow => workflow !== null,
	)
}

const memoizedDeployWorkflows = keyedMemoizeAsync(
	DEPLOY_WORKFLOWS_TTL_MS,
	(input: { token: string; fullName: string }) => input.fullName,
	fetchDeployWorkflows,
)

export const listDeployWorkflows = (
	token: string,
	fullName: string,
): Promise<ReadonlyArray<DeployWorkflow>> =>
	memoizedDeployWorkflows({ token, fullName })
