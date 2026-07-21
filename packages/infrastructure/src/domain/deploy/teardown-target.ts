import type { DeployTargetType } from '#/config/types.ts'

export type TeardownTarget = 'project' | 'vps'

export const TEARDOWN_TARGETS: readonly TeardownTarget[] = ['project', 'vps']

// Only the hetzner-vps target owns a server to scope a teardown to and Docker
// volumes to wipe; cloudflare-pages and cloudflare-workers are serverless and
// volumeless, so `vps` scope and `--with-volumes` are meaningless there.
export function validateTeardownOptions(
	deployTarget: DeployTargetType,
	target: TeardownTarget,
	shouldWipeVolumes: boolean,
): void {
	if (deployTarget === 'hetzner-vps') {
		return
	}
	if (target !== 'project') {
		throw new Error(
			`TEARDOWN_TARGET="${target}" is not supported for "${deployTarget}" deploys - only "project" scope exists (the "vps" scope is Hetzner-only)`,
		)
	}
	if (shouldWipeVolumes) {
		throw new Error(
			`TEARDOWN_WITH_VOLUMES=true is not supported for "${deployTarget}" deploys - only Hetzner VPS deploys have Docker volumes`,
		)
	}
}
