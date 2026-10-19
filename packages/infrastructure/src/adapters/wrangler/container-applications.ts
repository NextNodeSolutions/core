import { lookupContainerApplication } from '#/domain/cloudflare/workers/container-application-lookup.ts'
import { createLogger } from '@nextnode-solutions/logger'
import { array, object, optional, string } from 'valibot'

import { parseWranglerJsonArray } from './json-output.ts'
import { assertWranglerOk } from './runner.ts'

import type { ContainerApplicationListing } from '#/domain/cloudflare/workers/container-application-lookup.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

// `containers list --json` prints one page only, and wrangler sends no
// `per_page` on that path (`fetchContainerPage()` without arguments), so the
// API default applies. 25 is the only page size wrangler names for that
// endpoint (the `--per-page` default of the interactive listing): a listing
// that long is treated as possibly truncated.
export const CONTAINERS_LIST_PAGE_SIZE = 25

// `appsToJsonOutput`: `[{ id, name, state, instances, image, version, ... }]`,
// `image` being the reference the application is configured with.
const applicationsSchema = array(
	object({ id: string(), name: string(), image: optional(string()) }),
)

/** The applications on the first page of `wrangler containers list --json`. */
export async function listContainerApplications(
	runner: WranglerRunner,
): Promise<ContainerApplicationListing> {
	const listExec = await runner(['containers', 'list', '--json'])
	assertWranglerOk(listExec, 'containers list')
	const applications = parseWranglerJsonArray(
		listExec.stdout,
		applicationsSchema,
		'containers list --json',
	)
	return {
		applications,
		isComplete: applications.length < CONTAINERS_LIST_PAGE_SIZE,
	}
}

function unlistedApplicationError(name: string): Error {
	return new Error(
		`Container application "${name}" is not on the first page of \`wrangler containers list\` (${CONTAINERS_LIST_PAGE_SIZE} applications or more, a full page): the list is paginated, so the application may still exist. Check the Cloudflare dashboard (Workers & Pages, Containers) and delete it there or with \`wrangler containers delete <id>\`. While that first page stays full without it, teardown stops at this step.`,
	)
}

/**
 * Delete the container application named `name`. `wrangler delete` never
 * touches it, so teardown removes it first. Absent from a complete listing, it
 * is already gone; absent from a full page, it may exist further on, so this
 * throws rather than leaving it orphaned. `containers delete` asks no question
 * in CI.
 */
export async function deleteContainerApplication(
	name: string,
	runner: WranglerRunner,
): Promise<ResourceOutcome> {
	const lookup = lookupContainerApplication(
		await listContainerApplications(runner),
		name,
	)
	if (lookup.kind === 'unlisted') throw unlistedApplicationError(name)
	if (lookup.kind === 'absent') {
		logger.info(`Container application "${name}" already gone`)
		return { handled: false, detail: `already gone container "${name}"` }
	}
	const deleteExec = await runner([
		'containers',
		'delete',
		lookup.application.id,
	])
	assertWranglerOk(deleteExec, `containers delete (application "${name}")`)
	logger.info(`Container application "${name}" deleted`)
	return { handled: true, detail: `deleted container "${name}"` }
}
