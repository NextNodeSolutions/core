import type { ServiceName } from '#/config/service-config.ts'
import type { ServiceDefinition } from './service.ts'

/**
 * D1, KV and Queues are realised by the cloudflare-workers Terraform target,
 * not the Service CLI: Terraform creates the resource and threads its id into
 * the Worker's bindings. The registry still needs an entry per `SERVICE_NAMES`,
 * so each yields a definition whose `build()` returns no runtime `Service` -
 * there is nothing to provision or load env from on the CLI side.
 */
export function terraformBackedServiceDefinition<K extends ServiceName>(
	name: K,
): ServiceDefinition<K> {
	return { name, build: (): null => null }
}
