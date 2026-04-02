import { execSync } from "node:child_process";
import type { ScriptsSection } from "../config/schema.js";
import { logger } from "@nextnode-solutions/logger";

interface QualityTask {
	id: string;
	name: string;
	cmd: string;
}

interface QualityResult {
	id: string;
	name: string;
	success: boolean;
	durationMs: number;
	error?: string;
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

export function runQualityGate(tasks: QualityTask[], cwd: string): QualityResult[] {
	if (tasks.length === 0) {
		logger.info("No quality checks configured, skipping");
		return [];
	}

	logger.info(`Running ${tasks.length} quality check(s)...`);

	const results = tasks.map((task) => runTask(task, cwd));

	const passed = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	if (failed > 0) {
		logger.error(`Quality gate failed: ${passed}/${results.length} passed`);
		for (const result of results.filter((r) => !r.success)) {
			logger.error(`  ${result.name}: ${result.error}`);
		}
	} else {
		logger.info(`Quality gate passed: ${passed}/${results.length} checks`);
	}

	return results;
}

function runTask(task: QualityTask, cwd: string): QualityResult {
	logger.info(`Running ${task.name}...`);
	const start = performance.now();

	try {
		execSync(task.cmd, { cwd, stdio: "inherit" });
		const durationMs = Math.round(performance.now() - start);
		logger.info(`${task.name} passed (${durationMs}ms)`);
		return { id: task.id, name: task.name, success: true, durationMs };
	} catch (err) {
		const durationMs = Math.round(performance.now() - start);
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`${task.name} failed (${durationMs}ms)`);
		return { id: task.id, name: task.name, success: false, durationMs, error: message };
	}
}
