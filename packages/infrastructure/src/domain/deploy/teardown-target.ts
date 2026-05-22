export type TeardownTarget = 'project' | 'vps'

export const TEARDOWN_TARGETS: readonly TeardownTarget[] = ['project', 'vps']

// Static deploys (Cloudflare Pages) have no VPS to scope to and no volumes
// to wipe; only container deploys (Hetzner VPS) honor those options.
export function validateTeardownOptions(
	projectType: 'app' | 'static',
	target: TeardownTarget,
	withVolumes: boolean,
): void {
	if (projectType !== 'static') {
		return
	}
	if (target !== 'project') {
		throw new Error(
			`TEARDOWN_TARGET="${target}" is not supported for static deploys — only "project" scope exists`,
		)
	}
	if (withVolumes) {
		throw new Error(
			'TEARDOWN_WITH_VOLUMES=true is not supported for static deploys — static deploys have no volumes',
		)
	}
}
