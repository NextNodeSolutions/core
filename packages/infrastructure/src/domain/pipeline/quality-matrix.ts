import type { ProjectSection, ScriptsSection } from '#/config/types.ts'
import type { PipelineEnvironment } from '#/domain/environment.ts'

export interface PipelineContext {
	readonly environment: PipelineEnvironment
	readonly developmentEnabled: boolean
	readonly prodGateCommand: string
	readonly drizzleCheckCommand?: string
}

export interface QualityTask {
	id: string
	name: string
	cmd: string
	/**
	 * Whether the command runs the pipeline CLI from core's own checkout.
	 * The setup action places that checkout at `.infra/` inside the caller's
	 * workspace, so tasks without it must run in the caller's clean tree:
	 * a project script such as lint scans the repo root and would otherwise
	 * fail on core's own sources under core's checkout. Drives the quality
	 * job's `with: infra:` in the deploy workflows.
	 */
	readonly infra: boolean
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
			infra: false,
		})
	}

	if (scripts.test) {
		tasks.push({
			id: 'test',
			name: 'Test',
			cmd: buildCommand(scripts.test, project.filter),
			infra: false,
		})
	}

	if (pipeline.drizzleCheckCommand) {
		tasks.push({
			id: 'drizzle-check',
			name: 'Drizzle Check',
			cmd: pipeline.drizzleCheckCommand,
			infra: false,
		})
	}

	if (pipeline.environment === 'production' && pipeline.developmentEnabled) {
		tasks.push({
			id: 'prod-gate',
			name: 'Prod Gate',
			cmd: pipeline.prodGateCommand,
			infra: true,
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
