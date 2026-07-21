import { ensurePlanetscaleDatabase } from '#/adapters/planetscale/databases.ts'
import {
	computePlanetscaleDatabaseName,
	PLANETSCALE_ORGANIZATION,
} from '#/domain/cloudflare/workers/planetscale.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export interface ProvisionPlanetscaleInput {
	readonly config: CloudflareWorkersDeployableConfig
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceTokenId: string | undefined
	readonly serviceToken: string | undefined
}

/**
 * Create-if-absent the PlanetScale Postgres DB before Terraform runs (its
 * branch-role + Hyperdrive config reference the DB by name). A no-op when the
 * project declares no planetscale service; fails loud if it does but the
 * service-token credentials were not supplied to the factory.
 */
export function provisionPlanetscaleDatabase(
	input: ProvisionPlanetscaleInput,
): Promise<ResourceOutcome> {
	const { planetscale } = input.config.services
	if (!planetscale) {
		return Promise.resolve({
			handled: false,
			detail: 'no [services.planetscale] declared',
		})
	}
	if (!input.serviceTokenId || !input.serviceToken) {
		throw new Error(
			'cloudflare-workers provision needs PlanetScale service-token credentials (PLANETSCALE_SERVICE_TOKEN_ID + PLANETSCALE_SERVICE_TOKEN) because the project declares a PlanetScale database, but they were not provided.',
		)
	}
	return ensurePlanetscaleDatabase({
		organization: PLANETSCALE_ORGANIZATION,
		database: computePlanetscaleDatabaseName(
			input.projectName,
			input.environment,
		),
		serviceTokenId: input.serviceTokenId,
		serviceToken: input.serviceToken,
		...planetscale,
	})
}
