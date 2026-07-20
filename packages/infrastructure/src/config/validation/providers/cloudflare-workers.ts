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

// Fields a VPS deploy carries that a Worker cannot honour: there is no host to
// pin (`vps`), no filesystem to mount (`[[deploy.volumes]]`), and no server to
// size (`[deploy.hetzner]`). Reject them explicitly rather than parse-and-ignore,
// mirroring how cloudflare-pages rejects `[deploy.services]`/`[[deploy.cron]]`.
function unsupportedContainerFieldErrors(
	deployRecord: Record<string, unknown>,
): string[] {
	const errors: string[] = []
	if (deployRecord['vps'] !== undefined) {
		errors.push(
			'deploy.vps is not supported with deploy target "cloudflare-workers" (a Worker runs on Cloudflare\'s edge, not a pinned VPS)',
		)
	}
	if (deployRecord['volumes'] !== undefined) {
		errors.push(
			'[[deploy.volumes]] is not supported with deploy target "cloudflare-workers" (a Worker has no host filesystem - use [services.kv]/[services.d1]/[services.r2] for state)',
		)
	}
	if (deployRecord['hetzner'] !== undefined) {
		errors.push(
			'[deploy.hetzner] is not supported with deploy target "cloudflare-workers" (server sizing is meaningless on Cloudflare\'s edge)',
		)
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
			...unsupportedContainerFieldErrors(deployRecord),
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
