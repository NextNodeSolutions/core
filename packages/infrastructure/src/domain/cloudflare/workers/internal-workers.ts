import type { WorkerServiceConfig } from '#/config/types.ts'

/** Whether any Worker of the project sits behind Cloudflare Access. */
export function hasInternalWorker(
	services: Readonly<Record<string, WorkerServiceConfig>>,
): boolean {
	return Object.values(services).some(service => service.internal)
}
