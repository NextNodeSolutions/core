import { createLogger } from '@nextnode-solutions/logger'

import type { R2Operations } from '../r2/client.types.ts'

import { convergeVps } from './converge-vps.ts'
import { findServerById, findServersByLabels } from './hcloud-client.ts'
import { deleteState, writeState } from './hcloud-state.ts'
import type { HcloudProjectState } from './hcloud-state.types.ts'
import { completeProvisioning, createVps } from './provision-vps.ts'
import type { HetznerVpsTargetConfig } from './target.ts'

const logger = createLogger()

export async function freshProvision(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	projectName: string,
): Promise<void> {
	await checkForOrphans(config.credentials.hcloudToken, projectName)

	const { serverId, publicIp } = await createVps(config.credentials, {
		projectName,
		hetzner: config.hetzner,
	})

	const createdEtag = await writeState(r2, projectName, {
		phase: 'created',
		serverId,
		publicIp,
	})
	logger.info(
		`State written: phase=created for "${projectName}" (server ${serverId})`,
	)

	const { tailnetIp } = await completeProvisioning(config.credentials, {
		serverId,
		projectName,
	})

	const provisionedEtag = await writeState(
		r2,
		projectName,
		{ phase: 'provisioned', serverId, publicIp, tailnetIp },
		createdEtag,
	)
	logger.info(
		`State written: phase=provisioned for "${projectName}" (tailnet ${tailnetIp})`,
	)

	await runConvergence(
		config,
		r2,
		projectName,
		{ serverId, publicIp, tailnetIp },
		provisionedEtag,
	)
}

export async function resumeFromState(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	projectName: string,
	state: HcloudProjectState,
	etag: string,
): Promise<void> {
	const server = await findServerById(
		config.credentials.hcloudToken,
		state.serverId,
	)
	if (!server) {
		logger.warn(
			`Server ${state.serverId} not found — state is stale, wiping and re-provisioning`,
		)
		await deleteState(r2, projectName)
		await freshProvision(config, r2, projectName)
		return
	}

	if (state.phase === 'created') {
		await resumeFromCreated(config, r2, projectName, state, etag)
		return
	}

	if (state.phase === 'provisioned') {
		logger.info(
			`Resuming from phase=provisioned for "${projectName}" (server ${state.serverId})`,
		)
		await runConvergence(config, r2, projectName, state, etag)
		return
	}

	logger.info(
		`VPS already converged for "${projectName}" (server ${state.serverId}), re-running convergence`,
	)
	await runConvergence(config, r2, projectName, state, etag)
}

async function resumeFromCreated(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	projectName: string,
	state: HcloudProjectState & { phase: 'created' },
	etag: string,
): Promise<void> {
	logger.info(
		`Resuming from phase=created for "${projectName}" (server ${state.serverId})`,
	)

	const { tailnetIp } = await completeProvisioning(config.credentials, {
		serverId: state.serverId,
		projectName,
	})

	const provisionedEtag = await writeState(
		r2,
		projectName,
		{
			phase: 'provisioned',
			serverId: state.serverId,
			publicIp: state.publicIp,
			tailnetIp,
		},
		etag,
	)
	logger.info(
		`State written: phase=provisioned for "${projectName}" (tailnet ${tailnetIp})`,
	)

	await runConvergence(
		config,
		r2,
		projectName,
		{ serverId: state.serverId, publicIp: state.publicIp, tailnetIp },
		provisionedEtag,
	)
}

async function runConvergence(
	config: HetznerVpsTargetConfig,
	r2: R2Operations,
	projectName: string,
	state: { serverId: number; publicIp: string; tailnetIp: string },
	etag: string,
): Promise<void> {
	await convergeVps({
		host: state.tailnetIp,
		projectName,
		r2: config.r2,
		vector: config.vector,
		deployPrivateKey: config.credentials.deployPrivateKey,
		acmeEmail: config.acmeEmail,
	})

	await writeState(
		r2,
		projectName,
		{
			phase: 'converged',
			serverId: state.serverId,
			publicIp: state.publicIp,
			tailnetIp: state.tailnetIp,
			convergedAt: new Date().toISOString(),
		},
		etag,
	)

	logger.info(`Infrastructure ready for "${projectName}"`)
}

async function checkForOrphans(
	hcloudToken: string,
	projectName: string,
): Promise<void> {
	const orphans = await findServersByLabels(hcloudToken, {
		project: projectName,
		managed_by: 'nextnode',
	})
	if (orphans.length > 0) {
		const ids = orphans.map(s => s.id).join(', ')
		throw new Error(
			`Orphan server(s) detected for "${projectName}" (IDs: ${ids}) — run teardown or delete manually before provisioning`,
		)
	}
}
