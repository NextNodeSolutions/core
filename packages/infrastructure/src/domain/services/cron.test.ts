import { describe, expect, it } from 'vitest'

import { CRON_SERVICE_NAME, buildCronScheduler } from './cron.ts'

import type { CronJobConfig, UserServiceConfig } from '#/config/types.ts'

const WEB: UserServiceConfig = {
	port: 3000,
	url: 'example.com',
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
}

// An internal-only worker (no url) on a different port - used to prove a job
// can target a non-primary service and that the port comes from THAT service.
const WORKER: UserServiceConfig = {
	port: 4000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
}

const UPSTREAM: UserServiceConfig = {
	port: 8080,
	url: 'example.com',
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'upstream',
	ref: 'ghcr.io/acme/web:v1',
}

function job(overrides: Partial<CronJobConfig> = {}): CronJobConfig {
	return {
		name: 'cleanup',
		schedule: '0 3 * * *',
		path: '/api/cron/cleanup',
		method: 'POST',
		...overrides,
	}
}

describe('buildCronScheduler', () => {
	it('renders a cron sidecar that POSTs to the primary service over the compose network', () => {
		const scheduler = buildCronScheduler([job()], { web: WEB })

		expect(scheduler?.[CRON_SERVICE_NAME]?.environment.CRONTAB).toBe(
			"0 3 * * * wget -q -O /dev/null -T 30 --post-data='' 'http://web:3000/api/cron/cleanup'",
		)
	})

	it('omits --post-data for a GET job', () => {
		const scheduler = buildCronScheduler(
			[
				job({
					method: 'GET',
					schedule: '*/15 * * * *',
					path: '/api/ping',
				}),
			],
			{ web: WEB },
		)

		expect(scheduler?.[CRON_SERVICE_NAME]?.environment.CRONTAB).toBe(
			"*/15 * * * * wget -q -O /dev/null -T 30 'http://web:3000/api/ping'",
		)
	})

	it('targets the named service on its own port, not the primary', () => {
		const scheduler = buildCronScheduler(
			[job({ service: 'worker', path: '/internal/sweep' })],
			{ web: WEB, worker: WORKER },
		)

		expect(scheduler?.[CRON_SERVICE_NAME]?.environment.CRONTAB).toContain(
			'http://worker:4000/internal/sweep',
		)
	})

	it('renders one crontab line per job', () => {
		const scheduler = buildCronScheduler(
			[
				job({ name: 'a', schedule: '0 1 * * *', path: '/a' }),
				job({ name: 'b', schedule: '0 2 * * *', path: '/b' }),
			],
			{ web: WEB },
		)

		expect(
			scheduler?.[CRON_SERVICE_NAME]?.environment.CRONTAB.split('\n'),
		).toHaveLength(2)
	})

	it('single-quotes the target URL so a query string is inert to the shell crond runs the line through', () => {
		const scheduler = buildCronScheduler(
			[job({ path: '/api/cron/run?scope=all&force=1' })],
			{ web: WEB },
		)

		// Unquoted, the `&` would background wget at `?scope=all` and run
		// `force=1` as a separate command. Quoted, the whole URL is one argument.
		expect(scheduler?.[CRON_SERVICE_NAME]?.environment.CRONTAB).toBe(
			"0 3 * * * wget -q -O /dev/null -T 30 --post-data='' 'http://web:3000/api/cron/run?scope=all&force=1'",
		)
	})

	it('renders no sidecar when no job is declared', () => {
		expect(buildCronScheduler([], { web: WEB })).toBeNull()
	})

	it('gates on a build target with service_healthy', () => {
		const scheduler = buildCronScheduler([job()], { web: WEB })

		expect(scheduler?.[CRON_SERVICE_NAME]?.depends_on).toEqual({
			web: { condition: 'service_healthy' },
		})
	})

	it('gates on an upstream target with service_started (no forced probe)', () => {
		const scheduler = buildCronScheduler([job()], { web: UPSTREAM })

		expect(scheduler?.[CRON_SERVICE_NAME]?.depends_on).toEqual({
			web: { condition: 'service_started' },
		})
	})

	it('runs crond from the pinned alpine image via /bin/sh bootstrap', () => {
		const cron = buildCronScheduler([job()], { web: WEB })?.[
			CRON_SERVICE_NAME
		]

		expect(cron?.image).toBe('alpine:3.21')
		expect(cron?.restart).toBe('unless-stopped')
		expect(cron?.command.slice(0, 2)).toEqual(['/bin/sh', '-c'])
	})
})
