import { validateCronJobs } from '../cron.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { DeployProviderValidator } from './registry.ts'
function validateWorkerServiceUrls(
	services: Record<string, WorkerServiceConfig>,
	domain: string | undefined,
): string[] {
	const errors: string[] = []
	const firstSeenBy = new Map<string, string>()

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (typeof url === 'undefined') continue

		const owner = firstSeenBy.get(url)
		if (typeof owner === 'undefined') {
			firstSeenBy.set(url, name)
		} else {
			errors.push(
				`deploy.services.${name}.url "${url}" duplicates deploy.services.${owner}.url - each routed worker needs a distinct url`,
			)
		}

		if (
			typeof domain !== 'undefined' &&
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
const FREE_PLAN_RATE_LIMIT_RULES = 1
const FREE_PLAN_CUSTOM_RULES = 5
interface ZoneBarrier {
	readonly field: string
	readonly isDeclaredBy: (service: WorkerServiceConfig) => boolean
	readonly ceiling: number
	readonly ceilingReason: string
}

function zoneBarrierErrors(
	services: Record<string, WorkerServiceConfig>,
	{ field, isDeclaredBy, ceiling, ceilingReason }: ZoneBarrier,
): string[] {
	const declaring = Object.entries(services).filter(([, service]) =>
		isDeclaredBy(service),
	)
	const hostless = declaring
		.filter(([, service]) => typeof service.url === 'undefined')
		.map(
			([name]) =>
				`deploy.services.${name}.${field} requires deploy.services.${name}.url - a zone rule matches on the host, and no host is derivable for a worker without url`,
		)
	if (declaring.length <= ceiling) return hostless
	const names = declaring.map(([name]) => name).join(', ')
	return [
		...hostless,
		`deploy.services declares ${declaring.length} ${field} blocks (${names}) but ${ceilingReason}`,
	]
}

function validateZoneBarriers(
	services: Record<string, WorkerServiceConfig>,
): string[] {
	return [
		...zoneBarrierErrors(services, {
			field: 'rate_limit',
			isDeclaredBy: service => typeof service.rateLimit !== 'undefined',
			ceiling: FREE_PLAN_RATE_LIMIT_RULES,
			ceilingReason:
				'the Cloudflare Free plan allows a single rate limiting rule per zone - keep one',
		}),
		...zoneBarrierErrors(services, {
			field: 'public_paths',
			isDeclaredBy: service => typeof service.publicPaths !== 'undefined',
			ceiling: FREE_PLAN_CUSTOM_RULES,
			ceilingReason:
				'the Cloudflare Free plan allows five custom rules per zone',
		}),
	]
}
function unsupportedContainerFieldErrors(
	deployRecord: Record<string, unknown>,
): string[] {
	const errors: string[] = []
	if (typeof deployRecord['vps'] !== 'undefined') {
		errors.push(
			'deploy.vps is not supported with deploy target "cloudflare-workers" (a Worker runs on Cloudflare\'s edge, not a pinned VPS)',
		)
	}
	if (typeof deployRecord['volumes'] !== 'undefined') {
		errors.push(
			'[[deploy.volumes]] is not supported with deploy target "cloudflare-workers" (a Worker has no host filesystem - use [services.kv]/[services.d1]/[services.r2] for state)',
		)
	}
	if (typeof deployRecord['hetzner'] !== 'undefined') {
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
		const { secrets, generatedSecrets, workerServices, domain } = inputs
		const cronResult = validateCronJobs(
			deployRecord['cron'],
			new Set(Object.keys(workerServices)),
		)
		const serviceErrors = [
			...unsupportedContainerFieldErrors(deployRecord),
			...validateWorkerServiceUrls(workerServices, domain),
			...validateZoneBarriers(workerServices),
			...(cronResult.ok ? [] : cronResult.errors),
		]

		return {
			errors: serviceErrors,
			deploy: {
				target: 'cloudflare-workers',
				secrets,
				generatedSecrets,
				services: workerServices,
				cron: cronResult.ok ? cronResult.section : [],
			},
		}
	},
}
