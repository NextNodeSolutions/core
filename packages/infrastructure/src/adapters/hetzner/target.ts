import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { converge } from '../../cli/hetzner/converge.ts'
import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type {
	ContainerDeployConfig,
	ContainerDeployedEnvironment,
	DeployResult,
	DeployTarget,
} from '../../domain/deploy/target.ts'
import type { CaddyUpstream } from '../../domain/hetzner/caddy-config.ts'
import { buildCaddyConfig } from '../../domain/hetzner/caddy-config.ts'
import { renderCloudInit } from '../../domain/hetzner/cloud-init.ts'
import { formatComposeEnv } from '../../domain/hetzner/compose-env.ts'
import {
	CONTAINER_PORT,
	computeHostPort,
	renderComposeFile,
} from '../../domain/hetzner/compose-file.ts'
import { computeSilo } from '../../domain/hetzner/env-silo.ts'
import { renderVectorEnv } from '../../domain/hetzner/vector-env.ts'
import { renderVectorToml } from '../../domain/hetzner/vector-toml.ts'
import { R2Client } from '../r2/r2-client.ts'

import type { CreateServerInput } from './hcloud-client.ts'
import {
	applyFirewall,
	createFirewall,
	createServer,
	describeServer,
} from './hcloud-client.ts'
import type { FirewallRule } from './hcloud-firewall.ts'
import { readState, writeState } from './hcloud-state.ts'
import { createSshSession } from './ssh-session.ts'

const logger = createLogger()

const HCLOUD_IMAGE = 'debian-12'
const SSH_KEY_NAME = 'nextnode-ci'
const POLL_INTERVAL_MS = 5_000
const MAX_POLL_ATTEMPTS = 24
const SSH_RETRY_INTERVAL_MS = 5_000
const MAX_SSH_ATTEMPTS = 12

const CADDY_CONFIG_PATH = '/etc/caddy/config.json'

const FIREWALL_RULES: ReadonlyArray<FirewallRule> = [
	{
		description: 'HTTP',
		direction: 'in',
		protocol: 'tcp',
		port: '80',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'HTTPS',
		direction: 'in',
		protocol: 'tcp',
		port: '443',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'SSH',
		direction: 'in',
		protocol: 'tcp',
		port: '22',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
]

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} env var is required`)
	}
	return value
}

export class HetznerVpsTarget implements DeployTarget<ContainerDeployConfig> {
	readonly name = 'hetzner-vps'
	private readonly hetzner: HetznerVpsDeploySection['hetzner']
	private readonly hcloudToken: string
	private readonly deployPrivateKey: string
	private readonly deployPublicKey: string
	private readonly tailscaleAuthKey: string
	private readonly r2: R2Client

	constructor(hetzner: HetznerVpsDeploySection['hetzner']) {
		this.hetzner = hetzner
		this.hcloudToken = requireEnv('HETZNER_API_TOKEN')
		this.deployPrivateKey = requireEnv('DEPLOY_SSH_PRIVATE_KEY')
		this.deployPublicKey = requireEnv('DEPLOY_SSH_PUBLIC_KEY')
		this.tailscaleAuthKey = requireEnv('TAILSCALE_AUTH_KEY')
		this.r2 = new R2Client({
			endpoint: requireEnv('R2_ENDPOINT'),
			accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
			secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
			bucket: requireEnv('R2_STATE_BUCKET'),
		})
	}

	async ensureInfra(projectName: string): Promise<void> {
		const existing = await readState(this.r2, projectName)

		if (existing) {
			logger.info(
				`VPS already provisioned for "${projectName}" (server ${existing.state.serverId})`,
			)
			await this.runConvergence(existing.state.ip, projectName)
			return
		}

		const cloudInit = renderCloudInit({
			tailscaleAuthKey: this.tailscaleAuthKey,
			tailscaleHostname: projectName,
			deployPublicKey: this.deployPublicKey,
		})

		const serverInput: CreateServerInput = {
			name: projectName,
			serverType: this.hetzner.serverType,
			location: this.hetzner.location,
			image: HCLOUD_IMAGE,
			sshKeys: [SSH_KEY_NAME],
			userData: cloudInit,
			labels: { project: projectName, managed_by: 'nextnode' },
		}

		logger.info(
			`Creating VPS "${projectName}" (${this.hetzner.serverType} in ${this.hetzner.location})`,
		)
		const server = await createServer(this.hcloudToken, serverInput)

		const firewallName = `${projectName}-fw`
		logger.info(`Creating firewall "${firewallName}"`)
		const firewall = await createFirewall(
			this.hcloudToken,
			firewallName,
			FIREWALL_RULES,
		)
		await applyFirewall(this.hcloudToken, firewall.id, server.id)

		const ip = server.public_net.ipv4.ip
		await this.waitForServerRunning(server.id)
		await this.waitForSsh(ip)
		await this.runConvergence(ip, projectName)

		await writeState(this.r2, projectName, {
			serverId: server.id,
			ip,
			tailnetHostname: `${projectName}.tail0.ts.net`,
		})

		logger.info(`Infrastructure ready for "${projectName}"`)
	}

	async deploy(config: ContainerDeployConfig): Promise<DeployResult> {
		const start = Date.now()

		const existing = await readState(this.r2, config.projectName)
		if (!existing) {
			throw new Error(
				`No state for "${config.projectName}" - run ensureInfra first`,
			)
		}

		const session = await createSshSession({
			host: existing.state.ip,
			username: 'root',
			privateKey: this.deployPrivateKey,
		})

		try {
			const upstreams: CaddyUpstream[] = []
			const deployed: ContainerDeployedEnvironment[] = []

			for (const env of config.environments) {
				const silo = computeSilo(config.projectName, env.name)
				const hostPort = computeHostPort(env.name)
				const envDir = `/opt/apps/${config.projectName}/${env.name}`

				const allEnv = {
					PORT: String(CONTAINER_PORT),
					...env.envVars,
					...env.secrets,
				}
				await session.writeFile(
					`${envDir}/.env`,
					formatComposeEnv(allEnv),
				) // eslint-disable-line no-await-in-loop -- sequential SSH commands by design

				const composeContent = renderComposeFile({
					image: config.image,
					hostPort,
				})
				await session.writeFile(
					`${envDir}/compose.yaml`,
					composeContent,
				) // eslint-disable-line no-await-in-loop -- sequential SSH commands by design

				await session.exec(
					`docker compose -p ${silo.id} -f ${envDir}/compose.yaml pull`,
				) // eslint-disable-line no-await-in-loop -- sequential SSH commands by design
				await session.exec(
					`docker compose -p ${silo.id} -f ${envDir}/compose.yaml up -d --remove-orphans`,
				) // eslint-disable-line no-await-in-loop -- sequential SSH commands by design

				logger.info(`Deployed ${silo.id} on port ${hostPort}`)

				upstreams.push({
					hostname: env.hostname,
					dial: `localhost:${hostPort}`,
				})
				deployed.push({
					kind: 'container',
					name: env.name,
					imageRef: config.image,
					url: `https://${env.hostname}`,
					deployedAt: new Date(),
				})
			}

			const caddyConfig = JSON.stringify(
				buildCaddyConfig({
					upstreams,
					r2Storage: {
						host: requireEnv('R2_ENDPOINT'),
						bucket: requireEnv('R2_CERTS_BUCKET'),
						accessId: requireEnv('R2_ACCESS_KEY_ID'),
						secretKey: requireEnv('R2_SECRET_ACCESS_KEY'),
						prefix: `${config.projectName}/`,
					},
				}),
			)

			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info('Caddy config reloaded')

			return {
				projectName: config.projectName,
				deployedEnvironments: deployed,
				durationMs: Date.now() - start,
			}
		} finally {
			session.close()
		}
	}

	private async waitForServerRunning(serverId: number): Promise<void> {
		for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
			const server = await describeServer(this.hcloudToken, serverId) // eslint-disable-line no-await-in-loop -- sequential polling by design
			if (server.status === 'running') {
				logger.info(`Server ${serverId} is running`)
				return
			}
			logger.info(
				`Server ${serverId} status: ${server.status} (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`,
			)
			await sleep(POLL_INTERVAL_MS) // eslint-disable-line no-await-in-loop -- sequential polling by design
		}
		throw new Error(
			`Server ${serverId} did not reach "running" after ${MAX_POLL_ATTEMPTS} attempts`,
		)
	}

	private async waitForSsh(host: string): Promise<void> {
		for (let attempt = 1; attempt <= MAX_SSH_ATTEMPTS; attempt++) {
			try {
				// eslint-disable-next-line no-await-in-loop -- sequential retry by design
				const session = await createSshSession({
					host,
					username: 'root',
					privateKey: this.deployPrivateKey,
				})
				session.close()
				logger.info(`SSH reachable at ${host}`)
				return
			} catch {
				logger.info(
					`SSH not ready at ${host} (attempt ${attempt}/${MAX_SSH_ATTEMPTS})`,
				)
				await sleep(SSH_RETRY_INTERVAL_MS) // eslint-disable-line no-await-in-loop -- sequential retry by design
			}
		}

		throw new Error(
			`SSH to ${host} not reachable after ${MAX_SSH_ATTEMPTS} attempts`,
		)
	}

	private async runConvergence(
		host: string,
		projectName: string,
	): Promise<void> {
		const session = await createSshSession({
			host,
			username: 'root',
			privateKey: this.deployPrivateKey,
		})

		try {
			const caddyBaseConfig = JSON.stringify(
				buildCaddyConfig({
					upstreams: [],
					r2Storage: {
						host: requireEnv('R2_ENDPOINT'),
						bucket: requireEnv('R2_CERTS_BUCKET'),
						accessId: requireEnv('R2_ACCESS_KEY_ID'),
						secretKey: requireEnv('R2_SECRET_ACCESS_KEY'),
						prefix: `${projectName}/`,
					},
				}),
			)

			await converge(session, {
				projectName,
				vectorToml: renderVectorToml(),
				vectorEnv: renderVectorEnv({
					clientId: requireEnv('NN_CLIENT_ID'),
					project: projectName,
					vlUrl: requireEnv('NN_VL_URL'),
				}),
				caddyBaseConfig,
			})
		} finally {
			session.close()
		}
	}
}
