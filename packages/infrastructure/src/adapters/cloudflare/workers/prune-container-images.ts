import { listContainerApplications } from '#/adapters/wrangler/container-applications.ts'
import { deleteContainerImageTags } from '#/adapters/wrangler/containers.ts'
import { lookupContainerApplication } from '#/domain/cloudflare/workers/container-application-lookup.ts'
import { planImagePrune } from '#/domain/cloudflare/workers/container-image-prune.ts'
import { containerServiceEntries } from '#/domain/cloudflare/workers/container-services.ts'
import { computeWorkerScriptName } from '#/domain/cloudflare/workers/worker-name.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { DeployServiceConfig } from '#/config/types.ts'
import type { ContainerApplicationListing } from '#/domain/cloudflare/workers/container-application-lookup.ts'
import type { ImagePrunePlan } from '#/domain/cloudflare/workers/container-image-prune.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

export interface ContainerImagePruneInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly services: Readonly<Record<string, DeployServiceConfig>>
	// The tag this deploy pushes and every container will run.
	readonly deployedTag: string
	readonly runner: WranglerRunner
}

async function readListing(
	runner: WranglerRunner,
): Promise<ContainerApplicationListing | undefined> {
	try {
		return await listContainerApplications(runner)
	} catch (error) {
		logger.warn(
			`Not pruning container images: the applications could not be listed: ${String(error)}`,
		)
		return undefined
	}
}

/**
 * Read, before the push, which image each container application runs, and
 * plan the prune that follows a successful deploy: every container service,
 * routed or not, keeps its new tag and the tag it ran before, for a rollback.
 * A service whose previous image cannot be identified is left unpruned.
 */
export async function planContainerImagePrune(
	input: ContainerImagePruneInput,
): Promise<ReadonlyArray<ImagePrunePlan>> {
	const containers = containerServiceEntries(input.services)
	if (!containers.length) return []
	const listing = await readListing(input.runner)
	if (!listing) return []
	return containers.flatMap(([serviceName]) => {
		const repository = computeWorkerScriptName(
			input.projectName,
			input.environment,
			serviceName,
		)
		const lookup = lookupContainerApplication(listing, repository)
		const plan = planImagePrune(repository, input.deployedTag, lookup)
		if (plan) return [plan]
		logger.warn(
			`Not pruning container image "${repository}": the image its application runs could not be identified (${lookup.kind})`,
		)
		return []
	})
}

/**
 * Delete every tag the plans do not keep: every deploy pushes a new tag, and
 * the account's image storage is capped at 50 GB. Called only once every
 * service is deployed and smoke-checked, so a failed deploy leaves the tags
 * in place. A failed prune warns instead of failing a deploy that is already
 * live; the next deploy prunes again.
 */
export async function pruneContainerImages(
	plans: ReadonlyArray<ImagePrunePlan>,
	runner: WranglerRunner,
): Promise<void> {
	for (const plan of plans) {
		try {
			// eslint-disable-next-line no-await-in-loop -- one image at a time keeps the registry calls and the log in order
			await deleteContainerImageTags(
				plan.repository,
				plan.keepTags,
				runner,
			)
		} catch (error) {
			logger.warn(
				`Pruning the old tags of container image "${plan.repository}" failed; the next deploy retries: ${String(error)}`,
			)
		}
	}
}
