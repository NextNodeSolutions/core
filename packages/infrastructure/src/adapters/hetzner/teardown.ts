import { createLogger } from '@nextnode-solutions/logger'

import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import { executeHandlers } from '../../domain/deploy/execute-handlers.ts'
import type { ResourceOutcome } from '../../domain/deploy/resource-outcome.ts'
import type { TeardownResult } from '../../domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '../../domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import {
	VPS_MANAGED_RESOURCES,
	VPS_PROJECT_MANAGED_RESOURCES,
} from '../../domain/hetzner/managed-resources.ts'
import type { R2Client } from '../r2/client.ts'

import { createSshSession } from './ssh/session.ts'
import type { SshSession } from './ssh/session.types.ts'
import { readState } from './state/read-write.ts'
import {
	teardownProjectCaddyRoute,
	teardownProjectCerts,
	teardownProjectContainer,
} from './teardown-project.ts'
import {
	teardownFirewall,
	teardownServer,
	teardownTailscale,
	teardownVpsDns,
	teardownVpsState,
} from './teardown-vps.ts'

const logger = createLogger()

export interface HetznerTeardownContext {
	readonly projectName: string
	readonly domain: string | undefined
	readonly target: TeardownTarget
	readonly environment: AppEnvironment
	readonly hcloudToken: string
	readonly tailscaleAuthKey: string
	readonly deployPrivateKey: string
	readonly cloudflareApiToken: string
	readonly r2: R2Client
	readonly certsR2: R2Client
}

export async function runHetznerTeardown(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	if (ctx.target === 'vps') {
		return teardownVps(ctx)
	}
	return teardownProject(ctx)
}

async function teardownVps(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	const start = Date.now()

	const outcome = await executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => teardownServer(ctx.hcloudToken, ctx.r2, ctx.projectName),
		firewall: () => teardownFirewall(ctx.hcloudToken, ctx.projectName),
		tailscale: () =>
			teardownTailscale(ctx.tailscaleAuthKey, ctx.projectName),
		dns: () =>
			teardownVpsDns(ctx.domain, ctx.environment, ctx.cloudflareApiToken),
		state: () => teardownVpsState(ctx.r2, ctx.projectName),
	})

	logger.info(`VPS teardown complete for "${ctx.projectName}"`)

	return {
		kind: 'vps',
		scope: 'vps',
		outcome,
		durationMs: Date.now() - start,
	}
}

async function teardownProject(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	const start = Date.now()

	const existing = await readState(ctx.r2, ctx.projectName)
	if (!existing || existing.state.phase !== 'converged') {
		return teardownProjectWithoutSession(ctx, start)
	}

	const session = await createSshSession({
		host: existing.state.tailnetIp,
		username: 'deploy',
		privateKey: ctx.deployPrivateKey,
		expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
	})

	try {
		return await teardownProjectWithSession(ctx, session, start)
	} finally {
		session.close()
	}
}

async function teardownProjectWithSession(
	ctx: HetznerTeardownContext,
	session: SshSession,
	startMs: number,
): Promise<TeardownResult> {
	const projectHostname = ctx.domain
		? resolveDeployDomain(ctx.domain, ctx.environment)
		: undefined

	const outcome = await executeHandlers(VPS_PROJECT_MANAGED_RESOURCES, {
		container: () =>
			teardownProjectContainer(session, ctx.projectName, ctx.environment),
		caddy: () => teardownProjectCaddyRoute(session, projectHostname),
		certs: () => teardownProjectCerts(ctx.certsR2, ctx.projectName),
		dns: () =>
			teardownVpsDns(ctx.domain, ctx.environment, ctx.cloudflareApiToken),
		state: () => teardownVpsState(ctx.r2, ctx.projectName),
	})

	logger.info(`Project teardown complete for "${ctx.projectName}"`)

	return {
		kind: 'vps',
		scope: 'project',
		outcome,
		durationMs: Date.now() - startMs,
	}
}

async function teardownProjectWithoutSession(
	ctx: HetznerTeardownContext,
	startMs: number,
): Promise<TeardownResult> {
	const outcome = await executeHandlers(VPS_PROJECT_MANAGED_RESOURCES, {
		container: () => skipUnreachable(),
		caddy: () => skipUnreachable(),
		certs: () => teardownProjectCerts(ctx.certsR2, ctx.projectName),
		dns: () =>
			teardownVpsDns(ctx.domain, ctx.environment, ctx.cloudflareApiToken),
		state: () => teardownVpsState(ctx.r2, ctx.projectName),
	})

	logger.info(
		`Project teardown complete for "${ctx.projectName}" (no reachable VPS)`,
	)

	return {
		kind: 'vps',
		scope: 'project',
		outcome,
		durationMs: Date.now() - startMs,
	}
}

function skipUnreachable(): ResourceOutcome {
	return { handled: false, detail: 'VPS unreachable — skipped' }
}
