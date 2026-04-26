import { createLogger } from '@nextnode-solutions/logger'

import { executeHandlers } from '../../../domain/deploy/execute-handlers.ts'
import type {
	ResourceOutcome,
	VpsResourceOutcome,
} from '../../../domain/deploy/resource-outcome.ts'
import { goldenImageFingerprint } from '../../../domain/hetzner/golden-image.ts'
import { VPS_MANAGED_RESOURCES } from '../../../domain/hetzner/managed-resources.ts'
import { selectGoldenImage } from '../../../domain/hetzner/select-golden-image.ts'
import type { R2Operations } from '../../r2/client.types.ts'
import { findImagesByLabels } from '../api/image.ts'
import { findServerById, findServersByLabels } from '../api/server.ts'
import { GOLDEN_IMAGE_LABEL, GOLDEN_IMAGE_MAX_AGE_MS } from '../constants.ts'
import { convergeVps } from '../converge-vps.ts'
import { deleteState, writeState } from '../state/read-write.ts'
import type { HcloudVpsState } from '../state/types.ts'
import type { HetznerVpsTargetConfig } from '../target.ts'

import { buildGoldenImage } from './build-golden-image.ts'
import { completeProvisioning, createVps } from './create-vps.ts'

/**
 * DNS is handled by the separate `dns` command, not by provision.
 * Every provision path returns this same outcome.
 */
const DNS_PROVISION_OUTCOME: ResourceOutcome = {
	handled: false,
	detail: 'managed by dns command',
}

/**
 * Certs are managed by Caddy itself at runtime (ACME). Provision does not
 * pre-create them — every provision path returns this same outcome.
 */
const CERTS_PROVISION_OUTCOME: ResourceOutcome = {
	handled: false,
	detail: 'managed by Caddy at runtime',
}

const logger = createLogger()

async function ensureGoldenImage(token: string): Promise<number> {
	const currentFingerprint = goldenImageFingerprint()
	const snapshots = await findImagesByLabels(token, {
		managed_by: GOLDEN_IMAGE_LABEL,
	})

	const decision = selectGoldenImage({
		images: snapshots,
		currentFingerprint,
		nowMs: Date.now(),
		maxAgeMs: GOLDEN_IMAGE_MAX_AGE_MS,
	})

	if (decision.action === 'use') {
		logger.info(`Using golden image: ${decision.reason}`)
		return decision.imageId
	}

	logger.info(`Rebuilding golden image: ${decision.reason}`)
	const built = await buildGoldenImage(token)
	logger.info(
		`Golden image built: snapshot ${built.snapshotId} (fingerprint ${built.fingerprint})`,
	)
	return built.snapshotId
}

export async function freshProvision(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	vpsName: string,
): Promise<VpsResourceOutcome> {
	const existingServer = await findExistingVps(
		config.credentials.hcloudToken,
		vpsName,
	)
	if (existingServer) {
		assertModeMatches(vpsName, existingServer, config.internal)
		logger.info(
			`VPS "${vpsName}" already exists (server #${String(existingServer.serverId)}) — attaching instead of creating`,
		)
		return attachToExistingVps(config, r2, vpsName, existingServer)
	}

	const goldenImageId = await ensureGoldenImage(
		config.credentials.hcloudToken,
	)

	const {
		serverId,
		publicIp,
		outcome: serverOutcome,
	} = await createVps(config.credentials, {
		vpsName,
		hetzner: config.hetzner,
		internal: config.internal,
		goldenImageId,
	})

	const createdEtag = await writeState(r2, vpsName, {
		phase: 'created',
		serverId,
		publicIp,
	})
	logger.info(
		`State written: phase=created for VPS "${vpsName}" (server ${serverId})`,
	)

	const {
		tailnetIp,
		sshHostKeyFingerprint,
		firewallOutcome,
		tailscaleOutcome,
	} = await completeProvisioning(config.credentials, {
		serverId,
		vpsName,
		internal: config.internal,
	})

	const provisionedEtag = await writeState(
		r2,
		vpsName,
		{
			phase: 'provisioned',
			serverId,
			publicIp,
			tailnetIp,
			sshHostKeyFingerprint,
		},
		createdEtag,
	)
	logger.info(
		`State written: phase=provisioned for VPS "${vpsName}" (tailnet ${tailnetIp})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => serverOutcome,
		firewall: () => firewallOutcome,
		tailscale: () => tailscaleOutcome,
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(
				config,
				r2,
				vpsName,
				{
					serverId,
					publicIp,
					tailnetIp,
					sshHostKeyFingerprint,
				},
				provisionedEtag,
			),
	})
}

export async function resumeFromState(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	vpsName: string,
	state: HcloudVpsState,
	etag: string,
): Promise<VpsResourceOutcome> {
	const server = await findServerById(
		config.credentials.hcloudToken,
		state.serverId,
	)
	if (!server) {
		logger.warn(
			`Server ${state.serverId} not found - state is stale, wiping and re-provisioning`,
		)
		await deleteState(r2, vpsName)
		return freshProvision(config, r2, vpsName)
	}

	if (state.phase === 'created') {
		return resumeFromCreated(config, r2, vpsName, state, etag)
	}

	const label = state.phase === 'provisioned' ? 'Resuming from' : 'Re-running'
	logger.info(
		`${label} phase=${state.phase} for VPS "${vpsName}" (server ${state.serverId})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => ({
			handled: false,
			detail: `existing #${String(state.serverId)}`,
		}),
		firewall: () => ({ handled: false, detail: 'existing' }),
		tailscale: () => ({
			handled: false,
			detail: `existing (${state.tailnetIp})`,
		}),
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(
				config,
				r2,
				vpsName,
				{
					serverId: state.serverId,
					publicIp: state.publicIp,
					tailnetIp: state.tailnetIp,
					sshHostKeyFingerprint: state.sshHostKeyFingerprint,
				},
				etag,
			),
	})
}

async function resumeFromCreated(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	vpsName: string,
	state: HcloudVpsState & { phase: 'created' },
	etag: string,
): Promise<VpsResourceOutcome> {
	logger.info(
		`Resuming from phase=created for VPS "${vpsName}" (server ${state.serverId})`,
	)

	const {
		tailnetIp,
		sshHostKeyFingerprint,
		firewallOutcome,
		tailscaleOutcome,
	} = await completeProvisioning(config.credentials, {
		serverId: state.serverId,
		vpsName,
		internal: config.internal,
	})

	const provisionedEtag = await writeState(
		r2,
		vpsName,
		{
			phase: 'provisioned',
			serverId: state.serverId,
			publicIp: state.publicIp,
			tailnetIp,
			sshHostKeyFingerprint,
		},
		etag,
	)
	logger.info(
		`State written: phase=provisioned for VPS "${vpsName}" (tailnet ${tailnetIp})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => ({
			handled: false,
			detail: `existing #${String(state.serverId)}`,
		}),
		firewall: () => firewallOutcome,
		tailscale: () => tailscaleOutcome,
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(
				config,
				r2,
				vpsName,
				{
					serverId: state.serverId,
					publicIp: state.publicIp,
					tailnetIp,
					sshHostKeyFingerprint,
				},
				provisionedEtag,
			),
	})
}

async function convergeAndWriteState(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	vpsName: string,
	state: {
		serverId: number
		publicIp: string
		tailnetIp: string
		sshHostKeyFingerprint?: string | undefined
	},
	etag: string,
): Promise<ResourceOutcome> {
	await convergeVps({
		host: state.tailnetIp,
		vpsName,
		internal: config.internal,
		r2: config.r2,
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
		},
		etag,
	)

	logger.info(`Infrastructure ready for VPS "${vpsName}"`)
	return { handled: true, detail: 'written (converged)' }
}

interface ExistingVpsRef {
	readonly serverId: number
	readonly publicIp: string
	readonly mode: string | undefined
}

async function findExistingVps(
	hcloudToken: string,
	vpsName: string,
): Promise<ExistingVpsRef | null> {
	const matches = await findServersByLabels(hcloudToken, {
		vps: vpsName,
		managed_by: 'nextnode',
	})
	if (matches.length === 0) return null
	if (matches.length > 1) {
		const ids = matches.map(s => s.id).join(', ')
		throw new Error(
			`Multiple Hetzner servers labelled vps="${vpsName}" (IDs: ${ids}) — manual cleanup required before provisioning can attach`,
		)
	}
	const [server] = matches
	if (!server) {
		throw new Error(`Unreachable: matches has length 1 but no server`)
	}
	return {
		serverId: server.id,
		publicIp: server.public_net.ipv4.ip,
		mode: server.labels['mode'],
	}
}

function assertModeMatches(
	vpsName: string,
	existing: ExistingVpsRef,
	wantInternal: boolean,
): void {
	const wantMode = wantInternal ? 'internal' : 'public'
	if (existing.mode === undefined) {
		throw new Error(
			`VPS "${vpsName}" (server #${String(existing.serverId)}) has no \`mode\` label — refusing to attach. Re-provision the VPS or add label \`mode=${wantMode}\` manually.`,
		)
	}
	if (existing.mode !== wantMode) {
		throw new Error(
			`VPS "${vpsName}" is labelled \`mode=${existing.mode}\` but this project is \`mode=${wantMode}\`. Internal and public projects cannot share a VPS — use a distinct \`[deploy].vps\` name.`,
		)
	}
}

async function attachToExistingVps(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	vpsName: string,
	server: ExistingVpsRef,
): Promise<VpsResourceOutcome> {
	const createdEtag = await writeState(r2, vpsName, {
		phase: 'created',
		serverId: server.serverId,
		publicIp: server.publicIp,
	})
	logger.info(
		`State seeded: phase=created for attached VPS "${vpsName}" (server ${server.serverId})`,
	)

	const {
		tailnetIp,
		sshHostKeyFingerprint,
		firewallOutcome,
		tailscaleOutcome,
	} = await completeProvisioning(config.credentials, {
		serverId: server.serverId,
		vpsName,
		internal: config.internal,
	})

	const provisionedEtag = await writeState(
		r2,
		vpsName,
		{
			phase: 'provisioned',
			serverId: server.serverId,
			publicIp: server.publicIp,
			tailnetIp,
			sshHostKeyFingerprint,
		},
		createdEtag,
	)
	logger.info(
		`State written: phase=provisioned for attached VPS "${vpsName}" (tailnet ${tailnetIp})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => ({
			handled: false,
			detail: `attached #${String(server.serverId)}`,
		}),
		firewall: () => firewallOutcome,
		tailscale: () => tailscaleOutcome,
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(
				config,
				r2,
				vpsName,
				{
					serverId: server.serverId,
					publicIp: server.publicIp,
					tailnetIp,
					sshHostKeyFingerprint,
				},
				provisionedEtag,
			),
	})
}
