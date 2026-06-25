import type {
	CronJobConfig,
	CronMethod,
	UserServiceConfig,
} from '#/config/types.ts'

/**
 * Compose service name for the cron sidecar. One sidecar runs every declared
 * job (each as its own crontab line), reaching the target services as
 * `<service>:<port>` on the project's compose network - never a host port, so
 * the schedule is internal to the VPS.
 */
export const CRON_SERVICE_NAME = 'cron'

/**
 * The cron sidecar image. BusyBox `crond` + `wget` both ship in the base
 * alpine image, so a scheduled HTTP ping needs no custom build, no Docker
 * socket, and no dependency on the app image. Pinned so a tag re-point can't
 * silently change the scheduler across the fleet (same discipline as the
 * postgres/observability image constants).
 */
export const CRON_IMAGE = 'alpine:3.21'

/**
 * wget network timeout. A cron ping that hangs past this fails its run rather
 * than wedging crond's single run slot for the next tick.
 */
export const CRON_REQUEST_TIMEOUT_SECONDS = 30

/**
 * Bootstrap the sidecar: materialise the crontab from the `CRONTAB` env (kept
 * out of the command so the command string is identical regardless of the
 * jobs), then exec crond in the foreground, logging each run to the
 * container's stdout where Vector picks it up.
 */
const CRON_BOOTSTRAP =
	'mkdir -p /etc/crontabs && echo "$CRONTAB" > /etc/crontabs/root && exec crond -f -l 8 -L /dev/stdout -c /etc/crontabs'

type DependsOnCondition = 'service_healthy' | 'service_started'

export interface CronComposeService {
	readonly image: string
	readonly restart: string
	readonly environment: { readonly CRONTAB: string }
	readonly command: ReadonlyArray<string>
	readonly depends_on?: Readonly<
		Record<string, { readonly condition: DependsOnCondition }>
	>
}

interface CronTarget {
	readonly name: string
	readonly service: UserServiceConfig
}

// The job's target service: its own `service`, else the primary (first
// declared) service. Throws on an unresolved reference - validation already
// guarantees both (a declared ref and at least one service), so reaching here
// with neither is a wiring bug, not user error.
function resolveCronTarget(
	job: CronJobConfig,
	services: Readonly<Record<string, UserServiceConfig>>,
): CronTarget {
	const [primary] = Object.keys(services)
	const name = job.service ?? primary
	const service = name === undefined ? undefined : services[name]
	if (name === undefined || service === undefined) {
		throw new Error(
			`buildCronScheduler: cron job "${job.name}" has no resolvable target service`,
		)
	}
	return { name, service }
}

// BusyBox `wget`: GET by default, POST via `--post-data` (empty body - the
// trigger is the call, the app owns the work). `-q -O /dev/null` keeps the run
// log clean (crond logs the invocation itself); `-T` bounds a hung endpoint.
function buildWgetCommand(method: CronMethod, url: string): string {
	const base = `wget -q -O /dev/null -T ${String(CRON_REQUEST_TIMEOUT_SECONDS)}`
	if (method === 'POST') return `${base} --post-data='' ${url}`
	return `${base} ${url}`
}

function buildCrontabLine(job: CronJobConfig, target: CronTarget): string {
	const url = `http://${target.name}:${String(target.service.port)}${job.path}`
	return `${job.schedule} ${buildWgetCommand(job.method, url)}`
}

// Gate the sidecar on each distinct target so it does not fire its first tick
// before the app is up: a `build` service exposes /healthz (`service_healthy`),
// an `upstream` one carries no forced probe (`service_started`). Keying the
// record by service name dedupes targets shared by several jobs.
function buildDependsOn(
	targets: ReadonlyArray<CronTarget>,
): Pick<CronComposeService, 'depends_on'> {
	const dependencies: Record<string, { condition: DependsOnCondition }> = {}
	for (const { name, service } of targets) {
		dependencies[name] = {
			condition:
				service.source === 'build'
					? 'service_healthy'
					: 'service_started',
		}
	}
	if (Object.keys(dependencies).length === 0) return {}
	return { depends_on: dependencies }
}

/**
 * Build the `cron` compose sidecar from the project's [[deploy.cron]] jobs.
 * Returns `null` when no job is declared (no sidecar rendered). Each job
 * becomes one crontab line firing an internal HTTP request at its target
 * service over the compose network. Pure: no IO, no env, no clock.
 *
 * Not gated on environment - unlike the prod-only backup loop, a cron runs in
 * BOTH dev and prod. The two are isolated by construction: each environment is
 * its own compose stack with its own `cron` sidecar hitting its own app.
 */
export function buildCronScheduler(
	jobs: ReadonlyArray<CronJobConfig>,
	services: Readonly<Record<string, UserServiceConfig>>,
): Readonly<Record<string, CronComposeService>> | null {
	if (jobs.length === 0) return null

	const resolved = jobs.map(job => ({
		job,
		target: resolveCronTarget(job, services),
	}))
	const crontab = resolved
		.map(({ job, target }) => buildCrontabLine(job, target))
		.join('\n')

	return {
		[CRON_SERVICE_NAME]: {
			image: CRON_IMAGE,
			restart: 'unless-stopped',
			environment: { CRONTAB: crontab },
			command: ['/bin/sh', '-c', CRON_BOOTSTRAP],
			...buildDependsOn(resolved.map(({ target }) => target)),
		},
	}
}
