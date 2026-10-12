import { DEPLOY_TARGETS, PROJECT_TYPES, SECRET_GENERATORS } from './types.ts'

import type { DeployTargetType, ProjectType, SecretGenerator } from './types.ts'

const PROJECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_TYPES)
const DEPLOY_TARGET_SET: ReadonlySet<string> = new Set(DEPLOY_TARGETS)
const SECRET_GENERATOR_SET: ReadonlySet<string> = new Set(SECRET_GENERATORS)

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

export function isSecretGenerator(
	candidate: unknown,
): candidate is SecretGenerator {
	return typeof candidate === 'string' && SECRET_GENERATOR_SET.has(candidate)
}
