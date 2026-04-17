import { createLogger } from '@nextnode-solutions/logger'

import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	VpsProvisionResult,
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
	readonly internal: boolean
	readonly credentials: HetznerCredentials
	readonly vector: HetznerVectorConfig | null
	readonly cloudflareApiToken: string
	readonly acmeEmail: string
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

	async ensureInfra(projectName: string): Promise<VpsProvisionResult> {
		const start = Date.now()
		const existing = await readState(this.r2, projectName)

		if (existing) {
			await resumeFromState(
				this.config,
				this.r2,
				projectName,
				existing.state,
				existing.etag,
			)
			return this.readProvisionResult(projectName, start)
		}

		await freshProvision(this.config, this.r2, projectName)
		return this.readProvisionResult(projectName, start)
	}

	private async readProvisionResult(
		projectName: string,
		startMs: number,
	): Promise<VpsProvisionResult> {
		const finalState = await readState(this.r2, projectName)
		if (!finalState || finalState.state.phase === 'created') {
			throw new Error(
				`Provisioning did not reach a deployable state for "${projectName}"`,
			)
		}

		return {
			kind: 'vps',
			serverId: finalState.state.serverId,
			serverType: this.config.hetzner.serverType,
			location: this.config.hetzner.location,
			publicIp: finalState.state.publicIp,
			tailnetIp: finalState.state.tailnetIp,
			durationMs: Date.now() - startMs,
		}
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		const existing = await readState(this.r2, projectName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for "${projectName}"`,
			)
		}

		const records = computeVpsDnsRecords({
			domain,
			environment: this.config.environment,
			publicIp: existing.state.publicIp,
			internal: this.config.internal,
			tailnetIp: existing.state.tailnetIp,
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
				`Invariant: expected deployable state for "${projectName}"`,
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
					acmeEmail: this.config.acmeEmail,
					internal: this.config.internal,
					cloudflareApiToken: this.config.cloudflareApiToken,
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
