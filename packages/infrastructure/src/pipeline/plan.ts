import { appendFileSync } from "node:fs";
import { logger } from "@nextnode-solutions/logger";
import type { QualityTask } from "./quality.js";

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{ id: "skip", name: "No quality checks", cmd: "echo skipped" },
];

export function writePlanOutputs(tasks: ReadonlyArray<QualityTask>): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX;
	const matrixJson = JSON.stringify(qualityMatrix);

	writeOutput("quality_matrix", matrixJson);

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
