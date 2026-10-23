import { getContainer } from '@cloudflare/containers'

import {
	CONTAINER_NAMESPACE_BINDING,
	CONTAINER_TARGET_PORT_HEADER,
	CONTAINER_VERSION_BINDING,
	CONTAINER_VERSION_HEADER,
} from './contract.ts'
import { ServiceContainer } from './service-container.ts'

import type { GatewayEnv } from './service-container.ts'

export { ServiceContainer }

type HandlerEnv = GatewayEnv & {
	readonly [CONTAINER_NAMESPACE_BINDING]: DurableObjectNamespace<ServiceContainer>
}

const SERVICE_UNAVAILABLE = 503
const RETRY_AFTER_SECONDS = '1'

// A client must not pick the container port: the header `Container.fetch`
// honours is dropped before the request reaches the Durable Object, which
// gets this Worker version's id instead (see `resetIfStale`).
function toGatewayRequest(request: Request, versionId: string): Request {
	const headers = new Headers(request.headers)
	headers.delete(CONTAINER_TARGET_PORT_HEADER)
	headers.set(CONTAINER_VERSION_HEADER, versionId)
	return new Request(request, { headers })
}

// A thrown error means the object failed as a whole (it reset itself on a
// version change, or the runtime reset it) and was rebuilt on the current
// version: retry once. A body may have been consumed by the first attempt, so
// a request that carries one is told to retry instead.
async function fetchThroughGateway(
	stub: DurableObjectStub<ServiceContainer>,
	request: Request,
): Promise<Response> {
	try {
		return await stub.fetch(request)
	} catch (error) {
		console.warn('The gateway object failed; retrying once', error)
		if (request.body === null) return stub.fetch(request)
		return new Response('Service restarting', {
			status: SERVICE_UNAVAILABLE,
			headers: { 'retry-after': RETRY_AFTER_SECONDS },
		})
	}
}

export default {
	fetch(request: Request, env: HandlerEnv): Promise<Response> {
		return fetchThroughGateway(
			getContainer(env[CONTAINER_NAMESPACE_BINDING]),
			toGatewayRequest(request, env[CONTAINER_VERSION_BINDING].id),
		)
	},
} satisfies ExportedHandler<HandlerEnv>
