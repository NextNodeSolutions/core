import type { APIRoute } from 'astro'

import { resolveCloudflareClient } from '@/lib/adapters/cloudflare/accounts.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import {
	createPagesTail,
	deletePagesTail,
} from '@/lib/adapters/cloudflare/pages-tail.ts'
import type { PagesTailSession } from '@/lib/adapters/cloudflare/pages-tail.ts'
import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { logger } from '@/lib/adapters/logger.ts'

export const prerender = false

const SSE_KEEPALIVE_MS = 15_000
const TAIL_SUBPROTOCOL = 'trace-v1'

const SSE_RESPONSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

const sseFrame = (event: string, data: string): Uint8Array =>
	textEncoder.encode(`event: ${event}\ndata: ${data}\n\n`)

const sseComment = (message: string): Uint8Array =>
	textEncoder.encode(`: ${message}\n\n`)

// Cloudflare's trace-v1 WebSocket delivers every frame as a UTF-8-encoded
// binary blob, not a text frame — Node's native WebSocket surfaces those as
// `ArrayBuffer` or `Blob` depending on binaryType. Decode both back to JSON.
// We set `binaryType = 'arraybuffer'`, so the Blob branch is a fallback only.
// Returning sync where possible avoids a microtask per message under bursty
// load and keeps frame ordering trivial.
const decodeTailFrame = (
	data: unknown,
): string | null | Promise<string | null> => {
	if (typeof data === 'string') return data
	if (data instanceof ArrayBuffer) return textDecoder.decode(data)
	if (ArrayBuffer.isView(data)) return textDecoder.decode(data)
	if (data instanceof Blob) {
		return data.arrayBuffer().then(buffer => textDecoder.decode(buffer))
	}
	return null
}

// Every terminal path — success, upstream rejection, WS error — must produce a
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
	// Event handlers gate their writes on `signal.aborted` — no defensive
	// try/catch, no boolean flag, no race between concurrent handlers.
	const lifecycle = new AbortController()
	const { signal } = lifecycle

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const ws = new WebSocket(session.url, TAIL_SUBPROTOCOL)
			ws.binaryType = 'arraybuffer'

			const keepalive = setInterval(() => {
				if (signal.aborted) return
				controller.enqueue(sseComment('keepalive'))
			}, SSE_KEEPALIVE_MS)

			signal.addEventListener(
				'abort',
				() => {
					clearInterval(keepalive)
					ws.close()
					controller.close()
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
			const emitFrame = (
				payload: string | null,
				dataType: string,
			): void => {
				if (signal.aborted) return
				if (payload === null) {
					logger.warn('cloudflare.pages.tail: undecodable frame', {
						projectName,
						deploymentId,
						dataType,
					})
					return
				}
				controller.enqueue(sseFrame('invocation', payload))
			}
			ws.addEventListener('message', event => {
				const decoded = decodeTailFrame(event.data)
				const dataType = typeof event.data
				if (decoded instanceof Promise) {
					void decoded.then(payload => emitFrame(payload, dataType))
					return
				}
				emitFrame(decoded, dataType)
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
				lifecycle.abort('ws-error')
			})
			ws.addEventListener('close', () => lifecycle.abort('ws-close'))
		},
		cancel(reason) {
			lifecycle.abort(reason ?? 'consumer-cancel')
		},
	})

	return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}
