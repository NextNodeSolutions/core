import { createLogger } from '@nextnode-solutions/logger'

import type { HetznerVpsDeploySection } from '../../config/types.ts'
import { renderCloudInit } from '../../domain/hetzner/cloud-init.ts'
import { DEFAULT_FIREWALL_RULES } from '../../domain/hetzner/firewall-rules.ts'
import {
	deleteTailnetDevicesByHostname,
	getTailnetIpByHostname,
	mintAuthkey,
} from '../tailscale/oauth.ts'

import {
	HCLOUD_IMAGE,
	TAILSCALE_AUTHKEY_TTL_SECONDS,
	TAILSCALE_TAG,
} from './constants.ts'
import type { CreateServerInput } from './hcloud-client.ts'
import {
	applyFirewall,
	assertServerTypeAvailable,
	createFirewall,
	createServer,
} from './hcloud-client.ts'
import { waitForServerRunning } from './wait-for-server-running.ts'
import { waitForSsh } from './wait-for-ssh.ts'

const logger = createLogger()

export interface ProvisionVpsCredentials {
	readonly hcloudToken: string
	readonly tailscaleAuthKey: string
	readonly deployPublicKey: string
	readonly deployPrivateKey: string
}

export interface CreateVpsInput {
	readonly projectName: string
	readonly hetzner: HetznerVpsDeploySection['hetzner']
}

export interface CreateVpsResult {
	readonly serverId: number
	readonly publicIp: string
}

export interface CompleteProvisioningInput {
	readonly serverId: number
	readonly projectName: string
}

export interface CompleteProvisioningResult {
	readonly tailnetIp: string
}

export async function createVps(
	credentials: ProvisionVpsCredentials,
	input: CreateVpsInput,
): Promise<CreateVpsResult> {
	await assertServerTypeAvailable(
		credentials.hcloudToken,
		input.hetzner.serverType,
	)
	logger.info(
		`Preflight OK: server_type "${input.hetzner.serverType}" is available`,
	)

	const purged = await deleteTailnetDevicesByHostname(
		credentials.tailscaleAuthKey,
		input.projectName,
	)
	if (purged > 0) {
		logger.info(
			`Purged ${purged} stale tailnet device(s) with hostname "${input.projectName}"`,
		)
	}

	const minted = await mintAuthkey(
		credentials.tailscaleAuthKey,
		[TAILSCALE_TAG],
		TAILSCALE_AUTHKEY_TTL_SECONDS,
		`nextnode-infra provisioning ${input.projectName}`,
	)
	logger.info(
		`Minted ephemeral Tailscale authkey for "${input.projectName}" (expires ${minted.expires})`,
	)

	const cloudInit = renderCloudInit({
		tailscaleAuthKey: minted.key,
		tailscaleHostname: input.projectName,
		deployPublicKey: credentials.deployPublicKey,
	})

	const serverInput: CreateServerInput = {
		name: input.projectName,
		serverType: input.hetzner.serverType,
		location: input.hetzner.location,
		image: HCLOUD_IMAGE,
		userData: cloudInit,
		labels: { project: input.projectName, managed_by: 'nextnode' },
	}

	logger.info(
		`Creating VPS "${input.projectName}" (${input.hetzner.serverType} in ${input.hetzner.location})`,
	)
	const server = await createServer(credentials.hcloudToken, serverInput)

	return {
		serverId: server.id,
		publicIp: server.public_net.ipv4.ip,
	}
}

export async function completeProvisioning(
	credentials: ProvisionVpsCredentials,
	input: CompleteProvisioningInput,
): Promise<CompleteProvisioningResult> {
	await waitForServerRunning(credentials.hcloudToken, input.serverId)

	const firewallName = `${input.projectName}-fw`
	logger.info(`Ensuring firewall "${firewallName}"`)
	const firewall = await createFirewall(
		credentials.hcloudToken,
		firewallName,
		DEFAULT_FIREWALL_RULES,
	)
	await applyFirewall(credentials.hcloudToken, firewall.id, input.serverId)

	const tailnetIp = await getTailnetIpByHostname(
		credentials.tailscaleAuthKey,
		input.projectName,
	)
	logger.info(`Tailnet IP for "${input.projectName}": ${tailnetIp}`)

	await waitForSsh({
		host: tailnetIp,
		privateKey: credentials.deployPrivateKey,
	})

	return { tailnetIp }
}
