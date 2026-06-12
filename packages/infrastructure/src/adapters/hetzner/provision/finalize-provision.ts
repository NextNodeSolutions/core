import { convergeVps } from '#/adapters/hetzner/converge-vps.ts'
import { writeState } from '#/adapters/hetzner/state/read-write.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import { VPS_MANAGED_RESOURCES } from '#/domain/hetzner/managed-resources.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { completeProvisioning } from './create-vps.ts'

import type { HetznerVpsTargetConfig } from '#/adapters/hetzner/target.ts'
import type {
	ResourceOutcome,
	VpsResourceOutcome,
} from '#/domain/deploy/resource-outcome.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'

/**
 * DNS is handled by the separate `dns` command, not by provision.
 * Every provision path returns this same outcome.
 */
export const DNS_PROVISION_OUTCOME: ResourceOutcome = {
	handled: false,
	detail: 'managed by dns command',
}

/**
 * Certs are managed by Caddy itself at runtime (ACME). Provision does not
 * pre-create them - every provision path returns this same outcome.
 */
export const CERTS_PROVISION_OUTCOME: ResourceOutcome = {
	handled: false,
	detail: 'managed by Caddy at runtime',
}

const logger = createLogger()

// The (config, R2 client, VPS name) trio that every provision/resume step
// threads through. Bundled so they pass as one value instead of three params.
export interface VpsProvisionContext {
	readonly config: HetznerVpsTargetConfig
	readonly r2: ObjectStoreClient
	readonly vpsName: string
}

type VpsHostPorts = Readonly<Record<string, Readonly<Record<string, number>>>>

export interface ProvisionFromCreatedInput {
	readonly serverId: number
	readonly publicIp: string
	readonly hostPorts: VpsHostPorts
	readonly serverOutcome: ResourceOutcome
	readonly createdEtag: string
	/** Wording for the phase=provisioned log line ("VPS" or "attached VPS"). */
	readonly vpsLabel: 'VPS' | 'attached VPS'
}

/**
 * Shared tail of every provision path that starts from phase=created:
 * complete provisioning (firewall, tailscale, SSH), advance the state to
 * phase=provisioned under the created ETag, then run the managed-resource
 * handlers (which converge the VPS and write phase=converged).
 */
export async function provisionFromCreated(
	context: VpsProvisionContext,
	input: ProvisionFromCreatedInput,
): Promise<VpsResourceOutcome> {
	const { config, r2, vpsName } = context
	const {
		tailnetIp,
		sshHostKeyFingerprint,
		firewallOutcome,
		tailscaleOutcome,
	} = await completeProvisioning(config.credentials, {
		serverId: input.serverId,
		vpsName,
		internal: config.internal,
	})

	const provisionedState = {
		serverId: input.serverId,
		publicIp: input.publicIp,
		tailnetIp,
		sshHostKeyFingerprint,
		hostPorts: input.hostPorts,
	}
	const provisionedEtag = await writeState(
		r2,
		vpsName,
		{ phase: 'provisioned', ...provisionedState },
		input.createdEtag,
	)
	logger.info(
		`State written: phase=provisioned for ${input.vpsLabel} "${vpsName}" (tailnet ${tailnetIp})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => input.serverOutcome,
		firewall: () => firewallOutcome,
		tailscale: () => tailscaleOutcome,
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(context, provisionedState, provisionedEtag),
	})
}

export async function convergeAndWriteState(
	context: VpsProvisionContext,
	state: {
		serverId: number
		publicIp: string
		tailnetIp: string
		sshHostKeyFingerprint?: string | undefined
		hostPorts: VpsHostPorts
	},
	etag: string,
): Promise<ResourceOutcome> {
	const { config, r2, vpsName } = context
	await convergeVps({
		host: state.tailnetIp,
		vpsName,
		internal: config.internal,
		infraStorage: config.infraStorage,
		vector: config.vector,
		deployPrivateKey: config.credentials.deployPrivateKey,
		expectedHostKeyFingerprint: state.sshHostKeyFingerprint,
		acmeEmail: config.acmeEmail,
		cloudflareApiToken: config.cloudflareApiToken,
	})

	await writeState(
		r2,
		vpsName,
		{
			phase: 'converged',
			serverId: state.serverId,
			publicIp: state.publicIp,
			tailnetIp: state.tailnetIp,
			convergedAt: new Date().toISOString(),
			sshHostKeyFingerprint: state.sshHostKeyFingerprint,
			hostPorts: state.hostPorts,
		},
		etag,
	)

	logger.info(`Infrastructure ready for VPS "${vpsName}"`)
	return { handled: true, detail: 'written (converged)' }
}
