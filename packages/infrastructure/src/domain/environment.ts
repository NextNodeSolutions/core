import type { ProjectSection } from '../config/types.ts'

export const APP_ENVIRONMENTS = ['development', 'production'] as const
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number]
export type PipelineEnvironment = AppEnvironment | 'none'

function isAppEnvironment(value: string): value is AppEnvironment {
	const envs: readonly string[] = APP_ENVIRONMENTS
	return envs.includes(value)
}

export function resolveEnvironment(
	projectType: ProjectSection['type'],
	rawEnv: string | undefined,
): PipelineEnvironment {
	if (projectType === 'package') return 'none'

	if (!rawEnv || !isAppEnvironment(rawEnv)) {
		throw new Error(
			`PIPELINE_ENVIRONMENT must be one of ${APP_ENVIRONMENTS.join(', ')} for ${projectType} projects (got: ${rawEnv})`,
		)
	}
	return rawEnv
}
