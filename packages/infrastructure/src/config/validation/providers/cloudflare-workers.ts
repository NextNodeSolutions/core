import { DEFAULT_WORKER_ENTRY } from '#/config/types.ts'

import type { UserServiceConfig, WorkerServiceConfig } from '#/config/types.ts'
import type { DeployProviderValidator } from './registry.ts'

// A [deploy.services.<name>] entry parses through the shared container schema,
// so it arrives here as a UserServiceConfig. Project it onto the Worker shape:
// keep the runtime-wiring fields, drop the container-only ones, and default the
// bundle entry. Field-level rejection of the dropped container fields lands in
// US-1.2; this conversion stays lossless-where-it-matters and simple.
function toWorkerService(service: UserServiceConfig): WorkerServiceConfig {
	return {
		...(service.url === undefined ? {} : { url: service.url }),
		secrets: service.secrets,
		needs: service.needs,
		dependsOn: service.dependsOn,
		entry: DEFAULT_WORKER_ENTRY,
	}
}

export const cloudflareWorkers: DeployProviderValidator = {
	requiresDomain: true,
	requiresServices: true,
	validate(_deployRecord, inputs) {
		const services: Record<string, WorkerServiceConfig> = {}
		for (const [name, service] of Object.entries(inputs.services)) {
			services[name] = toWorkerService(service)
		}

		return {
			errors: [],
			deploy: {
				target: 'cloudflare-workers',
				secrets: inputs.secrets,
				generatedSecrets: inputs.generatedSecrets,
				vps: inputs.vps,
				volumes: inputs.volumes,
				services,
				cron: [],
			},
		}
	},
}
