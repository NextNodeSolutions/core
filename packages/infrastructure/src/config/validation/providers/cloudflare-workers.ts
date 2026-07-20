import { validateCronJobs } from '../cron.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { DeployProviderValidator } from './registry.ts'

// Cross-service routing guard: every externally routed Worker `url` must be
// unique - a duplicate would collide on the same custom domain - and must be
// project.domain itself or a sub-domain of it, since the zone the routes attach
// to is project.domain's. Workers without a `url` are internal-only (invoked via
// service bindings) and contribute nothing here. When `domain` is undefined the
// missing-domain error is already raised upstream, so ownership is left
// unchecked rather than double-reported.
function validateWorkerServiceUrls(
	services: Record<string, WorkerServiceConfig>,
	domain: string | undefined,
): string[] {
	const errors: string[] = []
	const firstSeenBy = new Map<string, string>()

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (url === undefined) continue

		const owner = firstSeenBy.get(url)
		if (owner === undefined) {
			firstSeenBy.set(url, name)
		} else {
			errors.push(
				`deploy.services.${name}.url "${url}" duplicates deploy.services.${owner}.url - each routed worker needs a distinct url`,
			)
		}

		if (
			domain !== undefined &&
			url !== domain &&
			!url.endsWith(`.${domain}`)
		) {
			errors.push(
				`deploy.services.${name}.url "${url}" must belong to project.domain "${domain}" (equal to it or a sub-domain)`,
			)
		}
	}

	return errors
}

export const cloudflareWorkers: DeployProviderValidator = {
	requiresDomain: true,
	requiresServices: true,
	validate(deployRecord, inputs) {
		const {
			secrets,
			generatedSecrets,
			vps,
			volumes,
			workerServices,
			domain,
		} = inputs
		const cronResult = validateCronJobs(
			deployRecord['cron'],
			new Set(Object.keys(workerServices)),
		)
		const serviceErrors = [
			...validateWorkerServiceUrls(workerServices, domain),
			...(cronResult.ok ? [] : cronResult.errors),
		]

		return {
			errors: serviceErrors,
			deploy: {
				target: 'cloudflare-workers',
				secrets,
				generatedSecrets,
				vps,
				volumes,
				services: workerServices,
				cron: cronResult.ok ? cronResult.section : [],
			},
		}
	},
}
