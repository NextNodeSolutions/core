import { serve } from '@hono/node-server'
import type { Logger } from '@nextnode-solutions/logger'
import { createLogger } from '@nextnode-solutions/logger'
import type { Hono } from 'hono'

import { createHttpServer } from '../adapters/http-server.ts'
import { createRateLimiterStore } from '../adapters/rate-limiter-store.ts'
import type { TokenStore } from '../adapters/token-store.ts'
import { openTokenStore } from '../adapters/token-store.ts'
import { createVictoriaLogsClient } from '../adapters/victorialogs-client.ts'

import { getEnv, requireEnv } from './env.ts'

const DEFAULT_HTTP_PORT = 4000
const MONITORING_DB_PATH_ENV = 'MONITORING_DB_PATH'
const MONITORING_VL_URL_ENV = 'MONITORING_VL_URL'
const MONITORING_HTTP_PORT_ENV = 'MONITORING_HTTP_PORT'

export interface BuildServeContextOptions {
	readonly dbPath: string
	readonly vlUrl: string
	readonly logger: Logger
	readonly fetchImpl?: typeof fetch
}

export interface ServeContext {
	readonly app: Hono
	readonly tokenStore: TokenStore
	readonly close: () => void
}

/**
 * Build the fully wired ingest stack WITHOUT starting a listener.
 *
 * Exposed as its own function so tests can drive the app via `app.request(...)`
 * without touching real ports, signal handlers, or process lifecycle.
 */
export function buildServeContext(
	options: BuildServeContextOptions,
): ServeContext {
	const tokenStore = openTokenStore(options.dbPath)
	const rateLimiter = createRateLimiterStore()
	const vlClient = createVictoriaLogsClient({
		endpoint: options.vlUrl,
		logger: options.logger,
		...(options.fetchImpl !== undefined && {
			fetchImpl: options.fetchImpl,
		}),
	})
	const app = createHttpServer({
		tokenStore,
		rateLimiter,
		vlClient,
		logger: options.logger,
		// v1 readiness is always-ready. A real probe against VL can be added
		// once we observe flaky startup in the deployed service — flagged in
		// the plan decision log.
		readinessCheck: () => Promise.resolve(true),
	})
	return {
		app,
		tokenStore,
		close: () => {
			tokenStore.close()
		},
	}
}

export async function serveCommand(args: readonly string[]): Promise<void> {
	if (args.length > 0) {
		throw new Error(
			`serve command takes no positional arguments, got: ${args.join(' ')}`,
		)
	}
	const dbPath = requireEnv(MONITORING_DB_PATH_ENV)
	const vlUrl = requireEnv(MONITORING_VL_URL_ENV)
	const portRaw = getEnv(MONITORING_HTTP_PORT_ENV)
	const port = portRaw === undefined ? DEFAULT_HTTP_PORT : Number(portRaw)
	if (!Number.isFinite(port) || port < 0) {
		throw new Error(
			`${MONITORING_HTTP_PORT_ENV} must be a non-negative integer, got: ${portRaw}`,
		)
	}

	const logger = createLogger({ prefix: 'monitoring', scope: 'serve' })
	const ctx = buildServeContext({ dbPath, vlUrl, logger })

	const server = serve({ fetch: ctx.app.fetch, port }, info => {
		logger.info('monitoring.serve.started', { port: info.port })
	})

	const shutdown = (signal: string): void => {
		logger.info('monitoring.serve.shutting_down', { signal })
		server.close(() => {
			ctx.close()
			logger.info('monitoring.serve.closed')
			process.exit(0)
		})
	}

	process.on('SIGTERM', () => {
		shutdown('SIGTERM')
	})
	process.on('SIGINT', () => {
		shutdown('SIGINT')
	})

	// Keep the function alive until the server closes — the signal handlers
	// above call process.exit(0). Using `await new Promise` would suspend
	// forever; instead we rely on the listener to hold the event loop.
	await Promise.resolve()
}
