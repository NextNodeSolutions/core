import { dirname } from "node:path";
import { loadConfig } from "./config/load.js";
import { logger } from "./lib/logger.js";
import { buildQualityMatrix, runQualityGate } from "./pipeline/quality.js";

function main(): void {
	const configPath = process.env["PIPELINE_CONFIG_FILE"];
	if (!configPath) {
		logger.error("PIPELINE_CONFIG_FILE is required");
		process.exit(1);
	}

	const action = process.env["PIPELINE_ACTION"] ?? "ci";

	logger.info(`Pipeline action: ${action}`);
	logger.info(`Config: ${configPath}`);

	const config = loadConfig(configPath);

	logger.info(`Project: ${config.project.name} (${config.project.type})`);

	if (action === "ci") {
		const tasks = buildQualityMatrix(config.scripts);
		const projectDir = dirname(configPath);
		const results = runQualityGate(tasks, projectDir);
		const failed = results.some((r) => !r.success);

		if (failed) {
			process.exit(1);
		}
	} else {
		logger.error(`Unknown action: ${action}`);
		process.exit(1);
	}
}

main();
