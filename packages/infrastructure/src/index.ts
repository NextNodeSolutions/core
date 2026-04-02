import { dirname } from "node:path";
import { logger } from "@nextnode-solutions/logger";
import { loadConfig } from "./config/load.js";
import { buildQualityMatrix, runQualityGate } from "./pipeline/quality.js";

const VALID_ACTIONS = new Set(["ci"]) as ReadonlySet<string>;

function main(): void {
	const configPath = process.env["PIPELINE_CONFIG_FILE"];
	if (!configPath) {
		throw new Error("PIPELINE_CONFIG_FILE env var is required");
	}

	const action = process.env["PIPELINE_ACTION"];
	if (!action) {
		throw new Error("PIPELINE_ACTION env var is required");
	}

	if (!VALID_ACTIONS.has(action)) {
		throw new Error(
			`Unknown PIPELINE_ACTION: "${action}". Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
		);
	}

	logger.info(`Pipeline action: ${action}`);
	logger.info(`Config: ${configPath}`);

	const config = loadConfig(configPath);
	logger.info(`Project: ${config.project.name} (${config.project.type})`);

	const tasks = buildQualityMatrix(config.scripts);
	const projectDir = dirname(configPath);
	const results = runQualityGate(tasks, projectDir);
	const failed = results.some((r) => !r.success);

	if (failed) {
		process.exit(1);
	}
}

main();
