import { Container } from '@cloudflare/containers'

import {
	isStartBackoff,
	nextStartBackoff,
	remainingBackoffMs,
	toRetryAfterSeconds,
} from './backoff.ts'
import {
	CONTAINER_BACKOFF_KEY,
	CONTAINER_ENV_DIGEST_KEY,
	CONTAINER_IMAGE_VAR,
	CONTAINER_PORT_VAR,
	CONTAINER_RELEASE_HEADER,
	CONTAINER_RELEASE_VAR,
	CONTAINER_SLEEP_AFTER_VAR,
	CONTAINER_VERSION_BINDING,
	CONTAINER_VERSION_HEADER,
	HEALTH_CHECK_PATH,
} from './contract.ts'
import { containerEnvVars, envDigest, parsePort } from './env.ts'

import type { DurableObject } from 'cloudflare:workers'
import type { StartBackoff } from './backoff.ts'

// A cold boot can outlast the class defaults (8 s to get an instance, 20 s for
// the port): wait long enough that a slow first response replaces a 503.
const INSTANCE_GET_TIMEOUT_MS = 30_000
const PORT_READY_TIMEOUT_MS = 120_000
// How long a container may take to exit on SIGTERM before it is killed.
const STOP_GRACE_MS = 15_000
const STOP_POLL_MS = 250
// The host and path the class requests to know that the port answers. Its
// default, `/`, is often a redirect to the app's public https URL, which the
// probe follows and a container port refuses.
const PING_ENDPOINT = `ping${HEALTH_CHECK_PATH}`
const SERVICE_UNAVAILABLE = 503
// A container still booting when a request's wait ends: the boot goes on,
// the client comes back soon.
const STILL_STARTING_RETRY_SECONDS = 5
const STALE_OBJECT_REASON =
	'The gateway object was built on a previous Worker version'

// The fields of the `version_metadata` binding the gateway reads.
interface VersionMetadata {
	readonly id: string
}

// The env of the gateway's objects: the handler's env adds the namespace
// binding (`worker.ts`), which an object never reads.
export interface GatewayEnv {
	readonly [CONTAINER_VERSION_BINDING]: VersionMetadata
	readonly [CONTAINER_PORT_VAR]: string
	readonly [CONTAINER_SLEEP_AFTER_VAR]: string
	readonly [CONTAINER_RELEASE_VAR]: string
	readonly [CONTAINER_IMAGE_VAR]: string
	readonly [name: string]: unknown
}

type ListenOutcome =
	| { readonly kind: 'listening' }
	// No start was attempted: the last ones failed, and the backoff holds.
	| { readonly kind: 'backing-off'; readonly retryAfterSeconds: number }

function unavailable(retryAfterSeconds: number): Response {
	return new Response('Service unavailable', {
		status: SERVICE_UNAVAILABLE,
		headers: { 'retry-after': String(retryAfterSeconds) },
	})
}

// The single instance behind the gateway. Options go through `super()`: a
// class field initializer would run after it and overwrite them.
export class ServiceContainer extends Container<GatewayEnv> {
	private readonly listenPort: number
	private readonly envDigest: Promise<string>
	private readonly versionId: string
	private readonly release: string
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
		this.envDigest = envDigest(envVars, env[CONTAINER_IMAGE_VAR])
		this.versionId = env[CONTAINER_VERSION_BINDING].id
		this.release = env[CONTAINER_RELEASE_VAR]
		this.pingEndpoint = PING_ENDPOINT
	}

	// Boot with the long timeouts, then forward through `super.fetch`, the
	// only path that carries WebSockets. The client sees no internal detail.
	override async fetch(request: Request): Promise<Response> {
		this.resetIfStale(request)
		let outcome: ListenOutcome
		try {
			outcome = await this.ensureListening(request.signal)
		} catch (error) {
			return this.startFailure(error, request.signal)
		}
		if (outcome.kind === 'backing-off')
			return unavailable(outcome.retryAfterSeconds)
		return this.tagRelease(request, await super.fetch(request))
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

	// The handler always runs the current version; this object may have been
	// built on the previous one, with its env. Resetting it fails this request,
	// which the handler retries against the rebuilt object.
	private resetIfStale(request: Request): void {
		const handlerVersion = request.headers.get(CONTAINER_VERSION_HEADER)
		if (handlerVersion === null || handlerVersion === this.versionId) return
		console.log(
			`Worker version ${handlerVersion} replaces ${this.versionId}: resetting the gateway object`,
		)
		this.ctx.abort(STALE_OBJECT_REASON)
		throw new Error(STALE_OBJECT_REASON)
	}

	// A running container serves when it was started with this env and image
	// (`reuseRunning`). Otherwise a start is due, unless the last ones failed
	// and the backoff holds. The digest is recorded as the container starts,
	// not once its port answers: a boot that outlasts the port wait keeps
	// running with this env, and the next request waits for it again.
	private async ensureListening(abort: AbortSignal): Promise<ListenOutcome> {
		const digest = await this.envDigest
		// During a stop or a restart `running` can read false while the old
		// process lives on: a request starting its own container here would be
		// killed by the transition. Wait for it, then look again.
		await this.waitForTransition()
		if (this.isRunning()) return this.reuseRunning(digest, abort)
		const backoffMs = remainingBackoffMs(
			await this.readBackoff(),
			this.release,
			Date.now(),
		)
		if (backoffMs > 0) {
			return {
				kind: 'backing-off',
				retryAfterSeconds: toRetryAfterSeconds(backoffMs),
			}
		}
		await this.ctx.storage.put(CONTAINER_ENV_DIGEST_KEY, digest)
		await this.startListening(abort)
		await this.ctx.storage.delete(CONTAINER_BACKOFF_KEY)
		return { kind: 'listening' }
	}

	// The env and the image are fixed when the Durable Object is built and
	// applied only when the container starts: a container running with others
	// (a rotated secret, a new deploy) is restarted with these. One still
	// booting is waited for: the boot goes on across requests.
	private async reuseRunning(
		digest: string,
		abort: AbortSignal,
	): Promise<ListenOutcome> {
		const applied = await this.ctx.storage.get(CONTAINER_ENV_DIGEST_KEY)
		if (applied !== digest) {
			await this.runTransition(() => this.restartWithEnv(digest))
			return { kind: 'listening' }
		}
		if ((await this.getState()).status !== 'healthy')
			await this.startListening(abort)
		return { kind: 'listening' }
	}

	// A start that failed on its own, not because the client left. A container
	// still running is still booting (a first pull of the image can outlast
	// the wait): the next request waits again. One that is not pushes the
	// next attempt back: an image that cannot boot is billed for every boot.
	private async startFailure(
		error: unknown,
		abort: AbortSignal,
	): Promise<Response> {
		if (abort.aborted) throw error
		if (this.isRunning()) {
			console.warn(
				`The container is still starting after ${String(PORT_READY_TIMEOUT_MS)} ms; the next request waits again`,
				error,
			)
			return unavailable(STILL_STARTING_RETRY_SECONDS)
		}
		const backoff = nextStartBackoff(
			await this.readBackoff(),
			this.release,
			Date.now(),
		)
		await this.ctx.storage.put(CONTAINER_BACKOFF_KEY, backoff)
		const retryAfterSeconds = toRetryAfterSeconds(
			backoff.until - Date.now(),
		)
		console.error(
			`The container did not start listening on port ${String(this.listenPort)} (failure ${String(backoff.failures)}): no start before ${String(retryAfterSeconds)} s`,
			error,
		)
		return unavailable(retryAfterSeconds)
	}

	private async readBackoff(): Promise<StartBackoff | undefined> {
		const stored = await this.ctx.storage.get(CONTAINER_BACKOFF_KEY)
		if (!isStartBackoff(stored)) return undefined
		return stored
	}

	// The health check carries the release this object was built for, so the
	// deploy smoke check proves that its deploy serves. A WebSocket response
	// cannot be rebuilt and never answers the health check.
	private tagRelease(request: Request, response: Response): Response {
		if (
			new URL(request.url).pathname !== HEALTH_CHECK_PATH ||
			response.webSocket !== null
		)
			return response
		const tagged = new Response(response.body, response)
		tagged.headers.set(CONTAINER_RELEASE_HEADER, this.release)
		return tagged
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
