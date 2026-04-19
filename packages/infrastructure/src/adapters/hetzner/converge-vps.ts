import { createLogger } from '@nextnode-solutions/logger'

import { converge } from '../../cli/hetzner/converge.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { extractUpstreams } from '../../domain/hetzner/caddy-config.ts'
import {
	CADDY_ENV_PATH,
	renderCaddyEnv,
} from '../../domain/hetzner/caddy-env.ts'
import { buildCaddyForProject } from '../../domain/hetzner/caddy-for-project.ts'
import { selectVectorConfig } from '../../domain/hetzner/vector-config.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { createSshSession } from './ssh/session.ts'

const logger = createLogger()

export interface ConvergeVpsVector {
	readonly clientId: string
	readonly vlUrl: string
}

export interface ConvergeVpsInput {
	readonly host: string
	readonly projectName: string
	readonly internal: boolean
	readonly r2: R2RuntimeConfig
	readonly vector: ConvergeVpsVector | null
	readonly deployPrivateKey: string
	readonly expectedHostKeyFingerprint?: string | undefined
	readonly acmeEmail: string
	readonly cloudflareApiToken: string
}

export async function convergeVps(input: ConvergeVpsInput): Promise<void> {
	const session = await createSshSession({
		host: input.host,
		username: 'deploy',
		privateKey: input.deployPrivateKey,
		expectedHostKeyFingerprint: input.expectedHostKeyFingerprint,
	})

	try {
		logger.info('Waiting for cloud-init to finish…')
		await session.exec('cloud-init status --wait')
		logger.info('cloud-init complete')

		const existingConfig = await session.readFile(CADDY_CONFIG_PATH)
		const existingUpstreams = extractUpstreams(existingConfig ?? '')

		// Write the Caddy env file BEFORE the JSON config so secrets referenced
		// via {env.X} placeholders resolve cleanly on the next (re)load.
		await session.writeFile(
			CADDY_ENV_PATH,
			renderCaddyEnv({
				r2: input.r2,
				cloudflareApiToken: input.cloudflareApiToken,
			}),
		)

		const caddyConfig = JSON.stringify(
			buildCaddyForProject({
				projectName: input.projectName,
				r2: input.r2,
				upstreams: existingUpstreams,
				acmeEmail: input.acmeEmail,
				internal: input.internal,
			}),
		)

		const vectorSelection = selectVectorConfig(
			input.vector
				? {
						clientId: input.vector.clientId,
						project: input.projectName,
						vlUrl: input.vector.vlUrl,
					}
				: null,
		)

		await converge(session, {
			projectName: input.projectName,
			vectorToml: vectorSelection.vectorToml,
			vectorEnv: vectorSelection.vectorEnv,
			caddyConfig,
		})
	} finally {
		session.close()
	}
}
