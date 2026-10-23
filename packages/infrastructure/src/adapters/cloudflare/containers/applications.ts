import { array, nullish, object, optional, safeParse, string } from 'valibot'

import { cloudflareGet, readResult } from '../api.ts'

import type { ContainerApplicationSummary } from '#/domain/cloudflare/workers/container-application.ts'
import type { CloudflareApiAccess, CloudflareEnvelope } from '../api.ts'

// `GET /accounts/{id}/containers/applications`: `name` filters the listing,
// `page_token` continues it, `per_page` bounds a page.
const PAGE_SIZE = '100'

// Only the fields read. `configuration` is absent on an application scheduled
// by Durable Objects alone, and `image` sits inside it.
const applicationsSchema = array(
	object({
		id: string(),
		name: string(),
		configuration: optional(object({ image: optional(string()) })),
	}),
)

const resultInfoSchema = optional(
	object({ next_page_token: nullish(string()) }),
)

function applicationsPath(
	access: CloudflareApiAccess,
	name: string,
	pageToken: string | undefined,
): string {
	const query = new URLSearchParams({ name, per_page: PAGE_SIZE })
	if (pageToken) query.set('page_token', pageToken)
	return `/accounts/${access.accountId}/containers/applications?${query.toString()}`
}

function nextPageToken(
	envelope: CloudflareEnvelope,
	label: string,
): string | undefined {
	const resultInfo = safeParse(resultInfoSchema, envelope.result_info)
	if (!resultInfo.success) {
		throw new Error(
			`${label}: unexpected \`result_info\` shape:\n${JSON.stringify(envelope.result_info)}`,
		)
	}
	return resultInfo.output?.next_page_token ?? undefined
}

/**
 * The container application named exactly `name`, or undefined when the
 * account has none: the API filters by name and every page is read, so an
 * absent application is proven absent, not missed past a page.
 */
export async function findContainerApplication(
	access: CloudflareApiAccess,
	name: string,
): Promise<ContainerApplicationSummary | undefined> {
	const label = `List the container applications named "${name}"`
	let pageToken: string | undefined
	do {
		// eslint-disable-next-line no-await-in-loop -- each page names the next one
		const envelope = await cloudflareGet(
			access,
			applicationsPath(access, name, pageToken),
			label,
		)
		const found = readResult(envelope, applicationsSchema, label).find(
			application => application.name === name,
		)
		if (found) {
			const image = found.configuration?.image
			return { id: found.id, name: found.name, ...(image && { image }) }
		}
		pageToken = nextPageToken(envelope, label)
	} while (pageToken)
	return undefined
}
