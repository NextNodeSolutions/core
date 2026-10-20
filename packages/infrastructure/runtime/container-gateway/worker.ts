import { Container, getContainer } from '@cloudflare/containers'

import {
	CONTAINER_CONTROL_PREFIX,
	CONTAINER_ENV_DIGEST_KEY,
	CONTAINER_NAMESPACE_BINDING,
	CONTAINER_PORT_VAR,
	CONTAINER_SLEEP_AFTER_VAR,
	CONTAINER_TARGET_PORT_HEADER,
	HEALTH_CHECK_PATH,
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
// The host and path the class requests to know that the port answers. Its
// default, `/`, is often a redirect to the app's public https URL, which the
// probe follows and a container port refuses.
const PING_ENDPOINT = `ping${HEALTH_CHECK_PATH}`
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
	// The stop or restart in progress, if any: a request waits for it instead
	// of reaching a container that is being stopped or replaced.
	private transition: Promise<void> | undefined

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
		this.pingEndpoint = PING_ENDPOINT
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

	// Idle for `sleep_after`. The class's default only sends SIGTERM, which a
	// PID 1 without an init (node, for one) ignores: the instance would keep
	// running, and billing, until the host recycles it. Escalate to SIGKILL.
	override async onActivityExpired(): Promise<void> {
		if (!this.isRunning()) return
		console.log(
			`Idle for ${String(this.sleepAfter)}: stopping the container`,
		)
		await this.runTransition(() => this.stopGracefully())
	}

	// The env is fixed when the Durable Object is built and applied only when
	// the container starts, so a container still running with another env (a
	// rotated secret, a new deploy) is restarted with this one. The digest is
	// recorded as the container starts, not once its port answers: a boot that
	// outlasts the port timeout keeps running with this env, and the next
	// request waits for it instead of restarting it.
	private async ensureListening(abort: AbortSignal): Promise<void> {
		const digest = await this.envDigest
		// During a stop or a restart `running` can read false while the old
		// process lives on: a request starting its own container here would be
		// killed by the transition. Wait for it, then look again.
		await this.waitForTransition()
		const applied = await this.ctx.storage.get(CONTAINER_ENV_DIGEST_KEY)
		if (this.isRunning() && applied !== digest)
			return this.runTransition(() => this.restartWithEnv(digest))
		if (this.isRunning() && (await this.getState()).status === 'healthy')
			return
		if (!this.isRunning())
			await this.ctx.storage.put(CONTAINER_ENV_DIGEST_KEY, digest)
		await this.startListening(abort)
	}

	// One transition at a time: a caller that finds one in progress shares it.
	private runTransition(work: () => Promise<void>): Promise<void> {
		this.transition ??= this.settle(work)
		return this.transition
	}

	private async settle(work: () => Promise<void>): Promise<void> {
		try {
			await work()
		} finally {
			this.transition = undefined
		}
	}

	// A failed transition is not this request's error: the checks after it
	// start a fresh container.
	private async waitForTransition(): Promise<void> {
		try {
			await this.transition
		} catch {
			// Ignored on purpose, see above.
		}
	}

	private async restartWithEnv(digest: string): Promise<void> {
		await this.stopGracefully()
		await this.ctx.storage.put(CONTAINER_ENV_DIGEST_KEY, digest)
		await this.startListening(undefined)
	}

	// `stop()` only sends SIGTERM: wait for the exit, then kill what is left,
	// so a start cannot take the already-running path with the old process.
	private async stopGracefully(): Promise<void> {
		await this.stop()
		for (
			let waited = 0;
			this.isRunning() && waited < STOP_GRACE_MS;
			waited += STOP_POLL_MS
		)
			// eslint-disable-next-line no-await-in-loop -- polls the exit of one process
			await scheduler.wait(STOP_POLL_MS)
		if (this.isRunning()) await this.destroy()
	}

	private isRunning(): boolean {
		return this.ctx.container?.running ?? false
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
