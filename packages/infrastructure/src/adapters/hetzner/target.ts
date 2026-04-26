import { createLogger } from '@nextnode-solutions/logger'

import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import type { VpsResourceOutcome } from '../../domain/deploy/resource-outcome.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	VpsProvisionResult,
} from '../../domain/deploy/target.ts'
import type { TeardownResult } from '../../domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '../../domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { extractUpstreams } from '../../domain/hetzner/caddy-config.ts'
import {
	CADDY_ENV_PATH,
	renderCaddyEnv,
} from '../../domain/hetzner/caddy-env.ts'
import { buildCaddyForProject } from '../../domain/hetzner/caddy-for-project.ts'
import { computeVpsDnsRecords } from '../../domain/hetzner/dns-records.ts'
import { reconcileDnsRecords } from '../cloudflare/dns/reconcile.ts'
import { R2Client } from '../r2/client.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { deployContainer } from './deploy-container.ts'
import { freshProvision, resumeFromState } from './provision/ensure-infra.ts'
import { createSshSession } from './ssh/session.ts'
import { readState } from './state/read-write.ts'
import { runHetznerTeardown } from './teardown.ts'

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
	readonly vpsName: string
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
	private readonly certsR2: R2Client

	constructor(config: HetznerVpsTargetConfig) {
		this.config = config
		this.r2 = new R2Client({
			endpoint: config.r2.endpoint,
			accessKeyId: config.r2.accessKeyId,
			secretAccessKey: config.r2.secretAccessKey,
			bucket: config.r2.stateBucket,
		})
		this.certsR2 = new R2Client({
			endpoint: config.r2.endpoint,
			accessKeyId: config.r2.accessKeyId,
			secretAccessKey: config.r2.secretAccessKey,
			bucket: config.r2.certsBucket,
		})
	}

	async ensureInfra(projectName: string): Promise<VpsProvisionResult> {
		const start = Date.now()
		// projectName is unused for VPS provisioning: provisioning is keyed
		// by vpsName so multiple projects on the same shared VPS reuse the
		// same provisioned host. The DeployTarget interface still passes it
		// for symmetry with deploy()/reconcileDns().
		void projectName
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)

		const outcome = existing
			? await resumeFromState(
					this.config,
					this.r2,
					vpsName,
					existing.state,
					existing.etag,
				)
			: await freshProvision(this.config, this.r2, vpsName)

		return this.readProvisionResult(start, outcome)
	}

	private async readProvisionResult(
		startMs: number,
		outcome: VpsResourceOutcome,
	): Promise<VpsProvisionResult> {
		const vpsName = this.config.vpsName
		const finalState = await readState(this.r2, vpsName)
		if (!finalState || finalState.state.phase === 'created') {
			throw new Error(
				`Provisioning did not reach a deployable state for VPS "${vpsName}"`,
			)
		}

		return {
			kind: 'vps',
			outcome,
			serverId: finalState.state.serverId,
			serverType: this.config.hetzner.serverType,
			location: this.config.hetzner.location,
			publicIp: finalState.state.publicIp,
			tailnetIp: finalState.state.tailnetIp,
			durationMs: Date.now() - startMs,
		}
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
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
			`DNS reconciled for "${projectName}" on VPS "${vpsName}" (${this.config.environment})`,
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
		const vpsName = this.config.vpsName

		if (!input.image) {
			throw new Error('image is required for Hetzner VPS deploys')
		}
		const hostname = resolveDeployDomain(
			this.config.domain,
			this.config.environment,
		)

		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'deploy',
			privateKey: this.config.credentials.deployPrivateKey,
			expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
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

			// Multi-tenant Caddy: read the existing config, drop any prior
			// upstream for THIS project's hostname (re-deploy case), then add
			// the fresh one. Upstreams from other projects on this VPS are
			// preserved untouched.
			const existingConfig = await session.readFile(CADDY_CONFIG_PATH)
			const existingUpstreams = extractUpstreams(existingConfig ?? '')
			const otherUpstreams = existingUpstreams.filter(
				u => u.hostname !== upstream.hostname,
			)
			const mergedUpstreams = [...otherUpstreams, upstream]

			const caddyConfig = JSON.stringify(
				buildCaddyForProject({
					projectName: vpsName,
					r2: this.config.r2,
					upstreams: mergedUpstreams,
					acmeEmail: this.config.acmeEmail,
					internal: this.config.internal,
				}),
			)

			// Refresh the env file so Caddy resolves the latest R2 + CF
			// secrets via {env.X} placeholders. Caddy re-reads EnvironmentFile
			// on systemctl restart only, so a rotation needs a restart — but
			// for normal deploys the values are unchanged and `caddy reload`
			// suffices.
			await session.writeFile(
				CADDY_ENV_PATH,
				renderCaddyEnv({
					r2: this.config.r2,
					cloudflareApiToken: this.config.cloudflareApiToken,
				}),
			)
			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info(
				`Caddy reloaded on VPS "${vpsName}" with ${String(mergedUpstreams.length)} upstream(s)`,
			)

			return {
				projectName,
				deployedEnvironments: [deployed],
				durationMs: Date.now() - start,
			}
		} finally {
			session.close()
		}
	}

	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
	): Promise<TeardownResult> {
		return runHetznerTeardown({
			projectName,
			vpsName: this.config.vpsName,
			domain,
			target,
			environment: this.config.environment,
			internal: this.config.internal,
			hcloudToken: this.config.credentials.hcloudToken,
			tailscaleAuthKey: this.config.credentials.tailscaleAuthKey,
			deployPrivateKey: this.config.credentials.deployPrivateKey,
			cloudflareApiToken: this.config.cloudflareApiToken,
			acmeEmail: this.config.acmeEmail,
			r2: this.r2,
			r2Runtime: this.config.r2,
			certsR2: this.certsR2,
		})
	}
}
