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

// What the Cloudflare Free plan allows PER ZONE - and a project owns one zone,
// so these are project ceilings. Counted here rather than per service: a
// per-service schema cannot see its siblings, and the alternative is
// discovering the refusal at `terraform apply`, after provisioning.
const FREE_PLAN_RATE_LIMIT_RULES = 1
const FREE_PLAN_CUSTOM_RULES = 5

// The barriers that become ZONE rules: they match on the host, so a worker with
// no `url` has no host to match and no rule to emit.
interface ZoneBarrier {
	readonly field: string
	readonly declaredBy: (service: WorkerServiceConfig) => boolean
	readonly ceiling: number
	readonly ceilingReason: string
}

const ZONE_BARRIERS: ReadonlyArray<ZoneBarrier> = [
	{
		field: 'rate_limit',
		declaredBy: service => typeof service.rateLimit !== 'undefined',
		ceiling: FREE_PLAN_RATE_LIMIT_RULES,
		ceilingReason:
			'the Cloudflare Free plan allows a single rate limiting rule per zone - keep one',
	},
	{
		field: 'public_paths',
		declaredBy: service => typeof service.publicPaths !== 'undefined',
		ceiling: FREE_PLAN_CUSTOM_RULES,
		ceilingReason:
			'the Cloudflare Free plan allows five custom rules per zone',
	},
]

function hostlessBarrierErrors(
	barrier: ZoneBarrier,
	declaring: ReadonlyArray<[string, WorkerServiceConfig]>,
): string[] {
	return declaring
		.filter(([, service]) => typeof service.url === 'undefined')
		.map(
			([name]) =>
				`deploy.services.${name}.${barrier.field} requires deploy.services.${name}.url - a zone rule matches on the host, and no host is derivable for a worker without url`,
		)
}

function ceilingErrors(
	barrier: ZoneBarrier,
	declaring: ReadonlyArray<[string, WorkerServiceConfig]>,
): string[] {
	if (declaring.length <= barrier.ceiling) return []
	const names = declaring.map(([name]) => name).join(', ')
	return [
		`deploy.services declares ${declaring.length} ${barrier.field} blocks (${names}) but ${barrier.ceilingReason}`,
	]
}

function barrierErrors(
	barrier: ZoneBarrier,
	declared: ReadonlyArray<[string, WorkerServiceConfig]>,
): string[] {
	const declaring = declared.filter(([, service]) =>
		barrier.declaredBy(service),
	)
	return [
		...hostlessBarrierErrors(barrier, declaring),
		...ceilingErrors(barrier, declaring),
	]
}

function validateZoneBarriers(
	services: Record<string, WorkerServiceConfig>,
): string[] {
	const declared = Object.entries(services)
	return ZONE_BARRIERS.flatMap(barrier => barrierErrors(barrier, declared))
}

// Fields a VPS deploy carries that a Worker cannot honour: there is no host to
// pin (`vps`), no filesystem to mount (`[[deploy.volumes]]`), and no server to
// size (`[deploy.hetzner]`). Reject them explicitly rather than parse-and-ignore,
// mirroring how cloudflare-pages rejects `[deploy.services]`/`[[deploy.cron]]`.
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
			...validateZoneBarriers(workerServices),
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
