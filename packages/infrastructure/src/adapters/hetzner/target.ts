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
import { computeVpsDnsRecords } from '../../domain/hetzner/dns-records.ts'
import { reconcileDnsRecords } from '../cloudflare/reconcile-dns.ts'
import { R2Client } from '../r2/client.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { deployContainer } from './deploy-container.ts'
import { freshProvision, resumeFromState } from './ensure-infra.ts'
import { readState } from './hcloud-state.ts'
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
	readonly cloudflareApiToken: string
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
			await resumeFromState(
				this.config,
				this.r2,
				projectName,
				existing.state,
				existing.etag,
			)
			return
		}

		await freshProvision(this.config, this.r2, projectName)
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		const existing = await readState(this.r2, projectName)
		if (!existing) {
			throw new Error(
				`No state for "${projectName}" — run ensureInfra first`,
			)
		}

		const records = computeVpsDnsRecords({
			domain,
			environment: this.config.environment,
			publicIp: existing.state.publicIp,
		})

		await reconcileDnsRecords(records, this.config.cloudflareApiToken)
		logger.info(
			`DNS reconciled for "${projectName}" (${this.config.environment})`,
		)
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
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`No deployable state for "${projectName}" — run ensureInfra first`,
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
				registryToken: input.registryToken!,
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
