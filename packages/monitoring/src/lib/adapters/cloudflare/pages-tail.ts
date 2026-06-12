import {
	apiDelete,
	apiPost,
	extractObjectResult,
} from '@/lib/adapters/cloudflare/client.ts'
import { logger } from '@/lib/adapters/logger.ts'

import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'

export interface PagesTailSession {
	readonly id: string
	readonly url: string
	// Pages /tails responses omit `expires_at` in practice even though Workers
	// sibling endpoints include it. Keep it optional and surface null upstream
	// so we never reject a valid session on a missing field.
	readonly expiresAt: string | null
}

export interface CreatePagesTailOptions {
	readonly client: CloudflareClient
	readonly projectName: string
	readonly deploymentId: string
}

const tailBasePath = (
	accountId: string,
	projectName: string,
	deploymentId: string,
): string =>
	`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}/tails`

// Creates a live log tail session on Cloudflare and returns its WebSocket URL.
// The same endpoint `wrangler pages deployment tail` uses - the returned `url`
// is a short-lived pre-authenticated wss endpoint that must be consumed with
// the `trace-v1` subprotocol.
export const createPagesTail = async ({
	client,
	projectName,
	deploymentId,
}: CreatePagesTailOptions): Promise<PagesTailSession> => {
	const context = `Cloudflare Pages tail session for "${projectName}"/"${deploymentId}"`
	const envelope = await apiPost(
		tailBasePath(client.accountId, projectName, deploymentId),
		client.token,
		context,
	)
	const session = extractObjectResult(envelope, context)
	if (typeof session.id !== 'string') {
		throw new Error(`${context}: missing \`id\``)
	}
	if (typeof session.url !== 'string') {
		throw new Error(`${context}: missing \`url\``)
	}
	const expiresAt =
		typeof session.expires_at === 'string' ? session.expires_at : null
	return { id: session.id, url: session.url, expiresAt }
}

export interface DeletePagesTailOptions {
	readonly client: CloudflareClient
	readonly projectName: string
	readonly deploymentId: string
	readonly tailId: string
}

// Best-effort cleanup - Cloudflare auto-expires tails, so a failed delete is
// logged but never raised: the main request pipeline must not fail because a
// housekeeping call did.
export const deletePagesTail = async ({
	client,
	projectName,
	deploymentId,
	tailId,
}: DeletePagesTailOptions): Promise<void> => {
	const context = `Cloudflare Pages tail delete for "${projectName}"/"${deploymentId}"/"${tailId}"`
	try {
		await apiDelete(
			`${tailBasePath(client.accountId, projectName, deploymentId)}/${encodeURIComponent(tailId)}`,
			client.token,
			context,
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.warn(`${context}: cleanup failed`, { message })
	}
}
