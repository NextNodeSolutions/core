import type { ProjectSection, ScriptsSection } from '#/config/types.ts'
import type { PipelineEnvironment } from '#/domain/environment.ts'

export interface PipelineContext {
	readonly environment: PipelineEnvironment
	readonly developmentEnabled: boolean
	readonly drizzleCheckCommand?: string
}

// A project script, run in the caller's clean tree: the quality job never
// checks core out, so a lint that scans the repository root sees the
// caller's sources only.
export interface QualityTask {
	id: string
	name: string
	cmd: string
}

// The caller's own checks, run in parallel with the build and the
// provisioning: the deploy waits for them, the infrastructure does not.
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

	if (pipeline.drizzleCheckCommand) {
		tasks.push({
			id: 'drizzle-check',
			name: 'Drizzle Check',
			cmd: pipeline.drizzleCheckCommand,
		})
	}

	return tasks
}

// A production deploy of a project with a development environment first
// checks that the same commit deployed to development. Its own job gates the
// provisioning, so no production change happens before it passes.
export function hasProdGate(
	pipeline: Pick<PipelineContext, 'environment' | 'developmentEnabled'>,
): boolean {
	return pipeline.environment === 'production' && pipeline.developmentEnabled
}

function buildCommand(script: string, filter: string | false): string {
	if (filter) {
		return `pnpm turbo run ${script} --filter=${filter}`
	}
	return `pnpm ${script}`
}
