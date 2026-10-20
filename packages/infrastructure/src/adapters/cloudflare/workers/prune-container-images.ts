import { findContainerApplication } from '#/adapters/cloudflare/containers/applications.ts'
import { deleteContainerImageTags } from '#/adapters/wrangler/containers.ts'
import { planImagePrune } from '#/domain/cloudflare/workers/container-image-prune.ts'
import { containerServiceEntries } from '#/domain/cloudflare/workers/container-services.ts'
import { computeWorkerScriptName } from '#/domain/cloudflare/workers/worker-name.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { CloudflareApiAccess } from '#/adapters/cloudflare/api.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { DeployServiceConfig } from '#/config/types.ts'
import type { ImagePrunePlan } from '#/domain/cloudflare/workers/container-image-prune.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

export interface ContainerImagePruneInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly services: Readonly<Record<string, DeployServiceConfig>>
	// The tag this deploy pushes and every container will run.
	readonly deployedTag: string
	readonly cloudflareApi: CloudflareApiAccess
}

// A service whose application cannot be read, or whose image is not a tag of
// its own repository, is left unpruned: a prune never guesses.
async function planOne(
	input: ContainerImagePruneInput,
	serviceName: string,
): Promise<ImagePrunePlan | undefined> {
	const repository = computeWorkerScriptName(
		input.projectName,
		input.environment,
		serviceName,
	)
	try {
		const application = await findContainerApplication(
			input.cloudflareApi,
			repository,
		)
		const plan = planImagePrune(repository, input.deployedTag, application)
		if (!plan) {
			logger.warn(
				`Not pruning container image "${repository}": its application runs "${application?.image ?? 'no image'}", not a tag of that repository`,
			)
		}
		return plan
	} catch (error) {
		logger.warn(
			`Not pruning container image "${repository}": its application could not be read: ${String(error)}`,
		)
		return undefined
	}
}

/**
 * Read, before the push, which image each container application runs, and
 * plan the prune that follows a successful deploy: every container service,
 * routed or not, keeps its new tag and the tag it ran before, for a rollback.
 */
export async function planContainerImagePrune(
	input: ContainerImagePruneInput,
): Promise<ReadonlyArray<ImagePrunePlan>> {
	const plans = await Promise.all(
		containerServiceEntries(input.services).map(([serviceName]) =>
			planOne(input, serviceName),
		),
	)
	return plans.flatMap(plan => (plan ? [plan] : []))
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
