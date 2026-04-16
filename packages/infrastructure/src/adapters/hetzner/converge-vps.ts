import { createLogger } from '@nextnode-solutions/logger'

import { converge } from '../../cli/hetzner/converge.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { buildCaddyForProject } from '../../domain/hetzner/caddy-for-project.ts'
import { selectVectorConfig } from '../../domain/hetzner/vector-config.ts'

import { createSshSession } from './ssh-session.ts'

const logger = createLogger()

export interface ConvergeVpsVector {
	readonly clientId: string
	readonly vlUrl: string
}

export interface ConvergeVpsInput {
	readonly host: string
	readonly projectName: string
	readonly r2: R2RuntimeConfig
	readonly vector: ConvergeVpsVector | null
	readonly deployPrivateKey: string
}

export async function convergeVps(input: ConvergeVpsInput): Promise<void> {
	const session = await createSshSession({
		host: input.host,
		username: 'deploy',
		privateKey: input.deployPrivateKey,
	})

	try {
		logger.info('Waiting for cloud-init to finish…')
		await session.exec('cloud-init status --wait')
		logger.info('cloud-init complete')

		const caddyBaseConfig = JSON.stringify(
			buildCaddyForProject({
				projectName: input.projectName,
				r2: input.r2,
				upstreams: [],
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
			caddyBaseConfig,
		})
	} finally {
		session.close()
	}
}
