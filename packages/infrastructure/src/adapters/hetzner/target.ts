import { createLogger } from '@nextnode-solutions/logger'

import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
} from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { buildCaddyForProject } from '../../domain/hetzner/caddy-for-project.ts'
import { R2Client } from '../r2/client.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { convergeVps } from './converge-vps.ts'
import { deployContainer } from './deploy-container.ts'
import { readState, writeState } from './hcloud-state.ts'
import { provisionVps } from './provision-vps.ts'
import { createSshSession } from './ssh-session.ts'

const logger = createLogger()

export interface HetznerCredentials {
	readonly hcloudToken: string
	readonly deployPrivateKey: string
	readonly deployPublicKey: string
	readonly tailscaleAuthKey: string
}

export interface HetznerVectorConfig {
	readonly clientId: string
	readonly vlUrl: string
}

export interface HetznerVpsTargetConfig {
	readonly hetzner: HetznerVpsDeploySection['hetzner']
	readonly r2: R2RuntimeConfig
	readonly environment: AppEnvironment
	readonly domain: string
	readonly credentials: HetznerCredentials
	readonly vector: HetznerVectorConfig | null
}

export class HetznerVpsTarget implements DeployTarget {
	readonly name = 'hetzner-vps'
	private readonly config: HetznerVpsTargetConfig
	private readonly r2: R2Client

	constructor(config: HetznerVpsTargetConfig) {
		this.config = config
		this.r2 = new R2Client({
			endpoint: config.r2.endpoint,
			accessKeyId: config.r2.accessKeyId,
			secretAccessKey: config.r2.secretAccessKey,
			bucket: config.r2.stateBucket,
		})
	}

	async ensureInfra(projectName: string): Promise<void> {
		const existing = await readState(this.r2, projectName)

		if (existing) {
			logger.info(
				`VPS already provisioned for "${projectName}" (server ${existing.state.serverId})`,
			)
			await convergeVps({
				host: existing.state.tailnetIp,
				projectName,
				r2: this.config.r2,
				vector: this.config.vector,
				deployPrivateKey: this.config.credentials.deployPrivateKey,
			})
			return
		}

		const provisioned = await provisionVps(this.config.credentials, {
			projectName,
			hetzner: this.config.hetzner,
		})

		await convergeVps({
			host: provisioned.tailnetIp,
			projectName,
			r2: this.config.r2,
			vector: this.config.vector,
			deployPrivateKey: this.config.credentials.deployPrivateKey,
		})

		await writeState(this.r2, projectName, {
			serverId: provisioned.serverId,
			publicIp: provisioned.publicIp,
			tailnetIp: provisioned.tailnetIp,
		})

		logger.info(`Infrastructure ready for "${projectName}"`)
	}

	async reconcileDns(): Promise<void> {
		throw new Error('reconcileDns not implemented for Hetzner VPS yet')
	}

	computeDeployEnv(): DeployEnv {
		return {
			SITE_URL: `https://${resolveDeployDomain(this.config.domain, this.config.environment)}`,
		}
	}

	async deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		const start = Date.now()

		if (!input.image) {
			throw new Error('image is required for Hetzner VPS deploys')
		}

		const hostname = resolveDeployDomain(
			this.config.domain,
			this.config.environment,
		)

		const existing = await readState(this.r2, projectName)
		if (!existing) {
			throw new Error(
				`No state for "${projectName}" - run ensureInfra first`,
			)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'deploy',
			privateKey: this.config.credentials.deployPrivateKey,
		})

		try {
			const { upstream, deployed } = await deployContainer(session, {
				projectName,
				environment: this.config.environment,
				hostname,
				env,
				secrets: input.secrets,
				image: input.image,
			})

			const caddyConfig = JSON.stringify(
				buildCaddyForProject({
					projectName,
					r2: this.config.r2,
					upstreams: [upstream],
				}),
			)

			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info('Caddy config reloaded')

			return {
				projectName,
				deployedEnvironments: [deployed],
				durationMs: Date.now() - start,
			}
		} finally {
			session.close()
		}
	}
}
