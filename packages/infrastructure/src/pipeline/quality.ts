import type { ProjectSection, ScriptsSection } from '../config/schema.js'

export type PipelineEnvironment = 'development' | 'production' | 'none'

export interface PipelineContext {
	readonly environment: PipelineEnvironment
	readonly developmentEnabled: boolean
}

export interface QualityTask {
	id: string
	name: string
	cmd: string
}

export function buildQualityMatrix(
	scripts: ScriptsSection,
	project: ProjectSection,
	pipeline: PipelineContext,
): QualityTask[] {
	const tasks: QualityTask[] = []

	if (scripts.lint) {
		tasks.push({
			id: 'lint',
			name: 'Lint',
			cmd: buildCommand(scripts.lint, project.filter),
		})
	}

	if (scripts.test) {
		tasks.push({
			id: 'test',
			name: 'Test',
			cmd: buildCommand(scripts.test, project.filter),
		})
	}

	if (pipeline.environment === 'production' && pipeline.developmentEnabled) {
		tasks.push({
			id: 'prod-gate',
			name: 'Prod Gate',
			cmd: 'cd .infra/packages/infrastructure && pnpm exec tsx src/index.ts prod-gate',
		})
	}

	return tasks
}

export function hasProdGate(tasks: ReadonlyArray<QualityTask>): boolean {
	return tasks.some(task => task.id === 'prod-gate')
}

function buildCommand(script: string, filter: string | false): string {
	if (filter) {
		return `pnpm turbo run ${script} --filter=${filter}`
	}
	return `pnpm ${script}`
}
