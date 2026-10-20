// The names the CLI and the gateway Worker must agree on. This file imports
// nothing: wrangler bundles it into the gateway, and the CLI reads it to
// generate the document, so neither side restates a name.

// The Durable Object class the gateway exports (`worker.ts`). A rename here
// must rename the class too: wrangler rejects a `class_name` the bundle lacks.
export const CONTAINER_GATEWAY_CLASS_NAME = 'ServiceContainer'

// Every gateway var or binding core sets starts with this prefix. The gateway
// forwards every other string of its env (public vars and secrets) to the
// container as environment variables.
export const CONTAINER_CONTROL_PREFIX = 'NN_CONTAINER_'

// The port the image listens on, as a decimal string.
export const CONTAINER_PORT_VAR = `${CONTAINER_CONTROL_PREFIX}PORT` as const

// The idle time before the instance sleeps (`10m`, `30s`, `1h`).
export const CONTAINER_SLEEP_AFTER_VAR =
	`${CONTAINER_CONTROL_PREFIX}SLEEP_AFTER` as const

// The release the deploy ships: the image tag, suffixed with the workflow run
// when CI sets one. The health check answers with it, so the deploy smoke
// check proves that its own release serves, not a previous version.
export const CONTAINER_RELEASE_VAR =
	`${CONTAINER_CONTROL_PREFIX}RELEASE` as const

// The Durable Object namespace binding of the gateway class.
export const CONTAINER_NAMESPACE_BINDING =
	`${CONTAINER_CONTROL_PREFIX}NAMESPACE` as const

// The Worker version metadata binding. Cloudflare keeps an active Durable
// Object on the version it was built on, with that version's env, for up to
// five minutes after a deploy: the handler sends its own version id, and an
// object built on another one resets itself.
export const CONTAINER_VERSION_BINDING =
	`${CONTAINER_CONTROL_PREFIX}VERSION` as const

// The request header `Container.fetch` reads to pick the container port. The
// gateway strips it from client requests so the port stays the declared one.
export const CONTAINER_TARGET_PORT_HEADER = 'cf-container-target-port'

// The request header carrying the handler's version id to the Durable Object.
// Set by the handler on every request, whatever the client sent.
export const CONTAINER_VERSION_HEADER = 'x-nn-gateway-version'

// The response header of the health check: the release of the Durable Object
// that served it.
export const CONTAINER_RELEASE_HEADER = 'x-nn-release'

// The Durable Object storage key of the digest of the env the running
// container was started with.
export const CONTAINER_ENV_DIGEST_KEY = `${CONTAINER_CONTROL_PREFIX}ENV_DIGEST`

// The Durable Object storage key of the start backoff (`backoff.ts`).
export const CONTAINER_BACKOFF_KEY = `${CONTAINER_CONTROL_PREFIX}BACKOFF`

// The path every routed service answers for the deploy smoke check. The
// gateway also probes it to know that the container listens: the probe follows
// redirects, and an app that redirects `/` to its public https URL would send
// it to an https URL, which a container port refuses.
export const HEALTH_CHECK_PATH = '/healthz'
