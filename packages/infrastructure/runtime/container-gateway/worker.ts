import { Container, getContainer } from '@cloudflare/containers'

import {
	CONTAINER_CONTROL_PREFIX,
	CONTAINER_ENV_DIGEST_KEY,
	CONTAINER_NAMESPACE_BINDING,
	CONTAINER_PORT_VAR,
	CONTAINER_SLEEP_AFTER_VAR,
	CONTAINER_TARGET_PORT_HEADER,
} from './contract.ts'

import type { DurableObject } from 'cloudflare:workers'

// A cold boot can outlast the class defaults (8 s to get an instance, 20 s for
// the port): wait long enough that a slow first response replaces a 503.
const INSTANCE_GET_TIMEOUT_MS = 30_000
const PORT_READY_TIMEOUT_MS = 120_000
// How long a container may take to exit on SIGTERM before it is killed.
const STOP_GRACE_MS = 15_000
const STOP_POLL_MS = 250
const LISTEN_HOST = '0.0.0.0'
const SERVICE_UNAVAILABLE = 503
const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2

interface GatewayEnv {
	readonly [CONTAINER_NAMESPACE_BINDING]: DurableObjectNamespace<ServiceContainer>
	readonly [CONTAINER_PORT_VAR]: string
	readonly [CONTAINER_SLEEP_AFTER_VAR]: string
	readonly [name: string]: unknown
}

// Vars and secrets reach the container as environment variables; core's
// control vars and the bindings stay in the gateway.
function containerEnvVars(
	env: GatewayEnv,
	port: number,
): Record<string, string> {
	const forwarded: Record<string, string> = {}
	for (const [name, value] of Object.entries(env)) {
		if (
			typeof value !== 'string' ||
			name.startsWith(CONTAINER_CONTROL_PREFIX)
		)
			continue
		forwarded[name] = value
	}
	return { ...forwarded, PORT: String(port), HOST: LISTEN_HOST }
}

// SHA-256 of the env sorted by name: equal envs give equal digests, and no
// value is stored in clear.
async function envDigest(
	envVars: Readonly<Record<string, string>>,
): Promise<string> {
	const sorted = Object.keys(envVars)
		.toSorted()
		.map(name => [name, envVars[name]])
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify(sorted)),
	)
	return Array.from(new Uint8Array(digest), byte =>
		byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0'),
	).join('')
}

function parsePort(raw: string): number {
	const port = Number(raw)
	if (!Number.isInteger(port))
		throw new Error(
			`${CONTAINER_PORT_VAR} must be an integer, got "${raw}"`,
		)
	return port
}

// The single instance behind the gateway. Options go through `super()`: a
// class field initializer would run after it and overwrite them.
export class ServiceContainer extends Container<GatewayEnv> {
	private readonly listenPort: number
	private readonly envDigest: Promise<string>
	// A request that arrives during an env restart joins it instead of
	// stopping the instance being started.
	private envRestart: Promise<void> | undefined

	constructor(ctx: DurableObject['ctx'], env: GatewayEnv) {
		const port = parsePort(env[CONTAINER_PORT_VAR])
		const envVars = containerEnvVars(env, port)
		super(ctx, env, {
			defaultPort: port,
			sleepAfter: env[CONTAINER_SLEEP_AFTER_VAR],
			envVars,
		})
		this.listenPort = port
		this.envDigest = envDigest(envVars)
	}

	// Boot with the long timeouts, then forward through `super.fetch`, the
	// only path that carries WebSockets. The client sees no internal detail.
	override async fetch(request: Request): Promise<Response> {
		try {
			await this.ensureListening(request.signal)
		} catch (error) {
			console.error(
				`The container did not start listening on port ${this.listenPort}`,
				error,
			)
			return new Response('Service unavailable', {
				status: SERVICE_UNAVAILABLE,
			})
		}
		return super.fetch(request)
	}

	// The env is fixed when the Durable Object is built and applied only when
	// the container starts, so a container still running with another env (a
	// rotated secret, a new deploy) is restarted with this one.
	private async ensureListening(abort: AbortSignal): Promise<void> {
		const digest = await this.envDigest
		// Once the old process has exited, `running` is false: a request that
		// checked it here would start its own container, which the restart in
		// progress would then kill. Join the restart first.
		if (this.envRestart) return this.joinEnvRestart(digest)
		const isRunning = this.ctx.container?.running ?? false
		const applied = await this.ctx.storage.get(CONTAINER_ENV_DIGEST_KEY)
		if (isRunning && applied !== digest) return this.joinEnvRestart(digest)
		if (isRunning && (await this.getState()).status === 'healthy') return
		await this.startListening(abort)
		await this.ctx.storage.put(CONTAINER_ENV_DIGEST_KEY, digest)
	}

	private async joinEnvRestart(digest: string): Promise<void> {
		this.envRestart ??= this.restartWithEnv(digest)
		try {
			await this.envRestart
		} finally {
			this.envRestart = undefined
		}
	}

	// `stop()` only sends SIGTERM: wait for the exit, then kill what is left,
	// so the start cannot take the already-running path with the old process.
	private async restartWithEnv(digest: string): Promise<void> {
		await this.stop()
		for (
			let waited = 0;
			(this.ctx.container?.running ?? false) && waited < STOP_GRACE_MS;
			waited += STOP_POLL_MS
		)
			// eslint-disable-next-line no-await-in-loop -- polls the exit of one process
			await scheduler.wait(STOP_POLL_MS)
		if (this.ctx.container?.running) await this.destroy()
		await this.startListening(undefined)
		await this.ctx.storage.put(CONTAINER_ENV_DIGEST_KEY, digest)
	}

	private startListening(abort: AbortSignal | undefined): Promise<void> {
		return this.startAndWaitForPorts({
			ports: [this.listenPort],
			cancellationOptions: {
				...(abort && { abort }),
				instanceGetTimeoutMS: INSTANCE_GET_TIMEOUT_MS,
				portReadyTimeoutMS: PORT_READY_TIMEOUT_MS,
			},
		})
	}
}

// A client must not pick the container port: the header `Container.fetch`
// honours is dropped before the request reaches the Durable Object.
function withoutPortOverride(request: Request): Request {
	const headers = new Headers(request.headers)
	headers.delete(CONTAINER_TARGET_PORT_HEADER)
	return new Request(request, { headers })
}

export default {
	fetch(request: Request, env: GatewayEnv): Promise<Response> {
		return getContainer(env[CONTAINER_NAMESPACE_BINDING]).fetch(
			withoutPortOverride(request),
		)
	},
} satisfies ExportedHandler<GatewayEnv>
