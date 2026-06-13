import type { Service, ServiceDefinition } from '#/cli/services/service.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

/**
 * The observability stack provisions nothing outside the VPS compose
 * project: containers, volumes and configs are all materialised at deploy
 * time by the compose renderer + stageRollout. The service still exists
 * in the registry so `[services.observability]` participates in the
 * compile-time completeness contract (teardown, validation, routing).
 *
 * `loadEnv` is empty by design - the stack's secrets (RESEND_API_KEY,
 * HEALTHCHECKS_PING_URL) travel through the `[deploy].secrets` global
 * pool and are consumed at deploy time by the alertmanager config
 * renderer, never by the app runtime.
 */
const EMPTY_ENV: ServiceEnv = { public: {}, secret: {} }

export const observabilityServiceDefinition: ServiceDefinition<'observability'> =
	{
		name: 'observability',
		build(services): Service | null {
			if (services.observability === undefined) return null
			return {
				name: 'observability',
				provision: async (): Promise<void> => {},
				loadEnv: async (): Promise<ServiceEnv> =>
					Promise.resolve(EMPTY_ENV),
			}
		},
	}
