import { resolveCloudflareClient } from '@/lib/adapters/cloudflare/accounts.ts'
import {
	createPagesTail,
	deletePagesTail,
} from '@/lib/adapters/cloudflare/pages-tail.ts'
import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { logger } from '@/lib/adapters/logger.ts'

import type { APIRoute } from 'astro'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { PagesTailSession } from '@/lib/adapters/cloudflare/pages-tail.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const SSE_KEEPALIVE_MS = 15_000
const TAIL_SUBPROTOCOL = 'trace-v1'

// Abort reason set by the ReadableStream `cancel` hook. The consumer-cancel
// path closes the stream BEFORE our abort listener runs, so the listener must
// skip controller.close() for this reason to avoid a double-close TypeError.
const CONSUMER_CANCEL_REASON = 'consumer-cancel'

const SSE_RESPONSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

const sseFrame = (event: string, payload: string): Uint8Array =>
	textEncoder.encode(`event: ${event}\ndata: ${payload}\n\n`)

const sseComment = (message: string): Uint8Array =>
	textEncoder.encode(`: ${message}\n\n`)

// Cloudflare's trace-v1 WebSocket delivers every frame as a UTF-8-encoded
// binary blob, not a text frame - Node's native WebSocket surfaces those as
// `ArrayBuffer` or `Blob` depending on binaryType. Decode both back to JSON.
// We set `binaryType = 'arraybuffer'`, so the Blob branch is a fallback only.
// Returning sync where possible avoids a microtask per message under bursty
// load and keeps frame ordering trivial.
const decodeTailFrame = (
	frame: unknown,
): string | null | Promise<string | null> => {
	if (typeof frame === 'string') return frame
	if (frame instanceof ArrayBuffer) return textDecoder.decode(frame)
	if (ArrayBuffer.isView(frame)) return textDecoder.decode(frame)
	if (frame instanceof Blob) {
		// oxlint-disable-next-line promise/prefer-await-to-then -- staying sync where possible avoids a microtask per message under bursty load (see comment above)
		return frame.arrayBuffer().then(buffer => textDecoder.decode(buffer))
	}
	return null
}

// Every terminal path - success, upstream rejection, WS error - must produce a
// 200 `text/event-stream` response, because `EventSource` auto-reconnects on
// any non-2xx status. We send a single `fatal` frame and close the stream so
// the client can render the real error and call `.close()` to stop retries.
const fatalSseResponse = (message: string): Response => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(sseFrame('fatal', JSON.stringify({ message })))
			controller.close()
		},
	})
	return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}

interface BootstrapOk {
	readonly kind: 'ok'
	readonly client: CloudflareClient
	readonly session: PagesTailSession
}

interface BootstrapFailed {
	readonly kind: 'failed'
	readonly message: string
}

const bootstrap = async (
	projectName: string,
	deploymentId: string,
): Promise<BootstrapOk | BootstrapFailed> => {
	try {
		const client = await resolveCloudflareClient()
		const session = await createPagesTail({
			client,
			projectName,
			deploymentId,
		})
		return { kind: 'ok', client, session }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('cloudflare.pages.tail: session bootstrap failed', {
			projectName,
			deploymentId,
			message,
		})
		return { kind: 'failed', message }
	}
}

interface TailStreamContext {
	readonly client: CloudflareClient
	readonly session: PagesTailSession
	readonly projectName: string
	readonly deploymentId: string
	readonly signal: AbortSignal
	readonly abort: (reason: string) => void
}

const registerTailCleanup = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	ws: WebSocket,
	keepalive: ReturnType<typeof setInterval>,
	context: TailStreamContext,
): void => {
	const { signal, client, projectName, deploymentId, session } = context
	signal.addEventListener(
		'abort',
		() => {
			clearInterval(keepalive)
			ws.close()
			// On the consumer-cancel path the ReadableStream has ALREADY
			// transitioned to "closed" before this listener runs (cancel() closes
			// the stream, then invokes our abort), so calling controller.close()
			// again throws a TypeError per the WHATWG Streams spec. Our own
			// terminal paths (ws-error, ws-close) abort while the stream is still
			// readable, so they must close it. The cancel hook normalises its
			// reason to CONSUMER_CANCEL_REASON, making this guard reliable.
			if (signal.reason !== CONSUMER_CANCEL_REASON) {
				controller.close()
			}
			void deletePagesTail({
				client,
				projectName,
				deploymentId,
				tailId: session.id,
			})
			logger.debug('cloudflare.pages.tail: stream closed', {
				projectName,
				deploymentId,
				tailId: session.id,
				reason: String(signal.reason),
			})
		},
		{ once: true },
	)
}

const emitInvocation = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	context: TailStreamContext,
	payload: string | null,
	dataType: string,
): void => {
	if (context.signal.aborted) return
	if (payload === null) {
		logger.warn('cloudflare.pages.tail: undecodable frame', {
			projectName: context.projectName,
			deploymentId: context.deploymentId,
			dataType,
		})
		return
	}
	controller.enqueue(sseFrame('invocation', payload))
}

const wireTailSocket = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	context: TailStreamContext,
): void => {
	const { signal, session, abort } = context
	const ws = new WebSocket(session.url, TAIL_SUBPROTOCOL)
	ws.binaryType = 'arraybuffer'

	const keepalive = setInterval(() => {
		if (signal.aborted) return
		controller.enqueue(sseComment('keepalive'))
	}, SSE_KEEPALIVE_MS)

	registerTailCleanup(controller, ws, keepalive, context)

	ws.addEventListener('open', () => {
		if (signal.aborted) return
		controller.enqueue(
			sseFrame(
				'session',
				JSON.stringify({
					id: session.id,
					expiresAt: session.expiresAt,
				}),
			),
		)
	})
	ws.addEventListener('message', event => {
		const decoded = decodeTailFrame(event.data)
		const dataType = typeof event.data
		if (decoded instanceof Promise) {
			// oxlint-disable-next-line promise/prefer-await-to-then -- detached emit keeps the sync-message fast path microtask-free (see decodeTailFrame)
			void decoded.then(payload =>
				emitInvocation(controller, context, payload, dataType),
			)
			return
		}
		emitInvocation(controller, context, decoded, dataType)
	})
	ws.addEventListener('error', () => {
		if (!signal.aborted) {
			controller.enqueue(
				sseFrame(
					'fatal',
					JSON.stringify({
						message: 'upstream tail websocket error',
					}),
				),
			)
		}
		abort('ws-error')
	})
	ws.addEventListener('close', () => abort('ws-close'))
}

export const GET: APIRoute = async ({ params }) => {
	const { name: projectName, id: deploymentId } = params
	if (!projectName || !deploymentId) {
		return new Response('missing route params', {
			status: HTTP_STATUS.BAD_REQUEST,
		})
	}

	const boot = await bootstrap(projectName, deploymentId)
	if (boot.kind === 'failed') return fatalSseResponse(boot.message)
	const { client, session } = boot

	// Single source of truth for the stream lifecycle: any terminal path
	// (consumer cancel, WS close, WS error, bootstrap success) aborts this
	// signal once, and a single `abort` listener performs every cleanup step.
	// Event handlers gate their writes on `signal.aborted` - no defensive
	// try/catch, no boolean flag, no race between concurrent handlers.
	const lifecycle = new AbortController()
	const abort = (reason: string): void => lifecycle.abort(reason)

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			wireTailSocket(controller, {
				client,
				session,
				projectName,
				deploymentId,
				signal: lifecycle.signal,
				abort,
			})
		},
		cancel() {
			// Always normalise to the sentinel: the runtime may pass an arbitrary
			// reason (or none), but every cancel here is a consumer disconnect, and
			// the abort listener relies on this exact value to skip the
			// already-done controller.close() (see registerTailCleanup).
			abort(CONSUMER_CANCEL_REASON)
		},
	})

	return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}
