import { appendFileSync } from "node:fs";
import { logger } from "@nextnode-solutions/logger";
import type { NextNodeConfig } from "../config/schema.js";
import type { QualityTask } from "./quality.js";

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{ id: "skip", name: "No quality checks", cmd: "echo skipped" },
];

interface PlanInput {
	readonly config: NextNodeConfig;
	readonly tasks: ReadonlyArray<QualityTask>;
}

export function writePlanOutputs({ config, tasks }: PlanInput): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX;
	const matrixJson = JSON.stringify(qualityMatrix);

	writeOutput("quality_matrix", matrixJson);
	writeOutput("project_name", config.project.name);
	writeOutput("project_type", config.project.type);

	logger.info(`Quality matrix: ${matrixJson}`);
	logger.info("Plan outputs written to GITHUB_OUTPUT");
}

function writeOutput(key: string, value: string): void {
	const outputFile = process.env["GITHUB_OUTPUT"];
	if (!outputFile) {
		throw new Error("GITHUB_OUTPUT env var is not set — are you running in GitHub Actions?");
	}
	appendFileSync(outputFile, `${key}=${value}\n`);
}
