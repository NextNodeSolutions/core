import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// `runtime/` sits next to `src/` in the infrastructure package. The CLI runs
// from source (`node src/index.ts` in core's checkout), so the gateway is found
// relative to this file; wrangler bundles it from there with the
// `@cloudflare/containers` dependency installed beside it.
const CONTAINER_GATEWAY_ENTRY = resolve(
	import.meta.dirname,
	'../../../../runtime/container-gateway/worker.ts',
)

/** The absolute path of the gateway Worker every container service deploys. */
export function resolveContainerGatewayEntry(): string {
	if (!existsSync(CONTAINER_GATEWAY_ENTRY)) {
		throw new Error(
			`The container gateway Worker is missing at ${CONTAINER_GATEWAY_ENTRY} - deploy runs the CLI from core's source checkout (node src/index.ts), where runtime/ sits next to src/`,
		)
	}
	return CONTAINER_GATEWAY_ENTRY
}
