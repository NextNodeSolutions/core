import type { ScriptsSection } from "../config/schema.js";

export interface QualityTask {
	id: string;
	name: string;
	cmd: string;
}

export function buildQualityMatrix(scripts: ScriptsSection): QualityTask[] {
	const tasks: QualityTask[] = [];

	if (scripts.lint) {
		tasks.push({ id: "lint", name: "Lint", cmd: `pnpm ${scripts.lint}` });
	}

	if (scripts.test) {
		tasks.push({ id: "test", name: "Test", cmd: `pnpm ${scripts.test}` });
	}

	return tasks;
}
