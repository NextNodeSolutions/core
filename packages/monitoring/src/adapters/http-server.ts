import type { Logger } from '@nextnode-solutions/logger'
import { Hono } from 'hono'

import { validateLogEnvelope } from '../domain/log-envelope.ts'
import { hashToken } from '../domain/token.ts'

import type { RateLimiterStore } from './rate-limiter-store.ts'
import type { TokenStore } from './token-store.ts'
import type {
	EnrichedLogEntry,
	VictoriaLogsClient,
} from './victorialogs-client.ts'

const BEARER_PREFIX = 'Bearer '
const MS_PER_SECOND = 1000

const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVICE_UNAVAILABLE = 503

export interface HttpServerDeps {
	readonly tokenStore: TokenStore
	readonly rateLimiter: RateLimiterStore
	readonly vlClient: VictoriaLogsClient
	readonly logger: Logger
	/**
	 * Readiness check: returns true when the server is prepared to accept
	 * traffic (SQLite open, VL reachable). `false` triggers a 503 on /ready.
	 * Kept as an injected promise so the CLI layer owns the check details.
	 */
	readonly readinessCheck: () => Promise<boolean>
}

export function createHttpServer(deps: HttpServerDeps): Hono {
	const app = new Hono()

	app.get('/health', c => c.body(null, HTTP_NO_CONTENT))

	app.get('/ready', async c => {
		const ready = await deps.readinessCheck()
		return c.body(null, ready ? HTTP_NO_CONTENT : HTTP_SERVICE_UNAVAILABLE)
	})

	app.post('/ingest/logs', async c => {
		const authHeader = c.req.header('Authorization')
		if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
			deps.logger.warn('ingest.auth.missing')
			return c.json(
				{ error: 'missing or malformed Authorization header' },
				HTTP_UNAUTHORIZED,
			)
		}
		const token = authHeader.slice(BEARER_PREFIX.length)
		const tenant = deps.tokenStore.findByHash(hashToken(token))
		if (tenant === null) {
			deps.logger.warn('ingest.auth.invalid')
			return c.json({ error: 'invalid token' }, HTTP_UNAUTHORIZED)
		}

		const rl = deps.rateLimiter.check(tenant.id, tenant.rateLimitRpm)
		if (!rl.allowed) {
			deps.logger.warn('ingest.rate_limit.exceeded', {
				tenantId: tenant.id,
				retryAfterMs: rl.retryAfterMs,
			})
			c.header(
				'Retry-After',
				String(Math.ceil(rl.retryAfterMs / MS_PER_SECOND)),
			)
			return c.json(
				{ error: 'rate limit exceeded' },
				HTTP_TOO_MANY_REQUESTS,
			)
		}

		let body: unknown
		try {
			body = await c.req.json()
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			deps.logger.warn('ingest.body.parse_error', {
				tenantId: tenant.id,
				error: message,
			})
			return c.json({ error: 'malformed JSON body' }, HTTP_BAD_REQUEST)
		}

		const validation = validateLogEnvelope(body)
		if (!validation.ok) {
			deps.logger.warn('ingest.body.invalid', {
				tenantId: tenant.id,
				error: validation.error,
			})
			return c.json({ error: validation.error }, HTTP_BAD_REQUEST)
		}

		const enriched: ReadonlyArray<EnrichedLogEntry> =
			validation.envelope.logs.map(entry => ({
				...entry,
				client_id: tenant.clientId,
				project: tenant.project,
				tenant_tier: tenant.tier,
			}))

		try {
			await deps.vlClient.push(enriched)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			deps.logger.error('ingest.forward.failed', {
				tenantId: tenant.id,
				count: enriched.length,
				error: message,
			})
			return c.json(
				{ error: 'unable to forward logs' },
				HTTP_SERVICE_UNAVAILABLE,
			)
		}

		deps.logger.info('ingest.ok', {
			tenantId: tenant.id,
			count: enriched.length,
		})
		return c.body(null, HTTP_NO_CONTENT)
	})

	return app
}
