import { DEPLOY_TARGETS, PROJECT_TYPES } from './types.ts'

import type { DeployTargetType, ProjectType } from './types.ts'

const PROJECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_TYPES)
const DEPLOY_TARGET_SET: ReadonlySet<string> = new Set(DEPLOY_TARGETS)

export function isProjectType(candidate: unknown): candidate is ProjectType {
	return typeof candidate === 'string' && PROJECT_TYPE_SET.has(candidate)
}

export function isScriptValue(candidate: unknown): candidate is string | false {
	return typeof candidate === 'string' || candidate === false
}

export function isDeployTarget(
	candidate: unknown,
): candidate is DeployTargetType {
	return typeof candidate === 'string' && DEPLOY_TARGET_SET.has(candidate)
}
