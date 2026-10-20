import { findContainerApplication } from '#/adapters/cloudflare/containers/applications.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { assertWranglerOk } from './runner.ts'

import type { CloudflareApiAccess } from '#/adapters/cloudflare/api.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

/**
 * Delete the container application named `name`. `wrangler delete` never
 * touches it, so teardown removes it first. The application is found through
 * the API, by name and across every page, so one absent there is gone and
 * not merely unlisted. `containers delete` asks no question in CI.
 */
export async function deleteContainerApplication(
	name: string,
	access: CloudflareApiAccess,
	runner: WranglerRunner,
): Promise<ResourceOutcome> {
	const application = await findContainerApplication(access, name)
	if (!application) {
		logger.info(`Container application "${name}" already gone`)
		return { handled: false, detail: `already gone container "${name}"` }
	}
	const deleteExec = await runner(['containers', 'delete', application.id])
	assertWranglerOk(deleteExec, `containers delete (application "${name}")`)
	logger.info(`Container application "${name}" deleted`)
	return { handled: true, detail: `deleted container "${name}"` }
}
