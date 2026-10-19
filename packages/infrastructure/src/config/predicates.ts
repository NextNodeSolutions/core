import { DEPLOY_TARGETS } from './types.ts'

import type { DeployTargetType } from './types.ts'

const DEPLOY_TARGET_SET: ReadonlySet<string> = new Set(DEPLOY_TARGETS)

export function isDeployTarget(
	candidate: unknown,
): candidate is DeployTargetType {
	return typeof candidate === 'string' && DEPLOY_TARGET_SET.has(candidate)
}
