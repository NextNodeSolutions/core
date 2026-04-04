import type { ProjectSection, ScriptsSection } from "../config/schema.js";

export interface QualityTask {
	id: string;
	name: string;
	cmd: string;
}

export function buildQualityMatrix(
	scripts: ScriptsSection,
	project: ProjectSection,
): QualityTask[] {
	const tasks: QualityTask[] = [];

	if (scripts.lint) {
		tasks.push({ id: "lint", name: "Lint", cmd: buildCommand(scripts.lint, project.filter) });
	}

	if (scripts.test) {
		tasks.push({ id: "test", name: "Test", cmd: buildCommand(scripts.test, project.filter) });
	}

	return tasks;
}

function buildCommand(script: string, filter: string | false): string {
	if (filter) {
		return `pnpm turbo run ${script} --filter=${filter}`;
	}
	return `pnpm ${script}`;
}
