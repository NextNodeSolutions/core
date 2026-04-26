import type { ProjectSection, ScriptsSection } from '#/config/types.ts'
import type { PipelineEnvironment } from '#/domain/environment.ts'

export interface PipelineContext {
	readonly environment: PipelineEnvironment
	readonly developmentEnabled: boolean
	readonly prodGateCommand: string
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
			cmd: pipeline.prodGateCommand,
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
