import { dirname } from "node:path";
import { logger } from "@nextnode-solutions/logger";
import { loadConfig } from "./config/load.js";
import { buildQualityMatrix } from "./pipeline/quality.js";
import { writePlanOutputs } from "./pipeline/plan.js";

function main(): void {
	const configPath = process.env["PIPELINE_CONFIG_FILE"];
	if (!configPath) {
		throw new Error("PIPELINE_CONFIG_FILE env var is required");
	}

	const config = loadConfig(configPath);

	logger.info(`Config: ${configPath}`);
	logger.info(`Project: ${config.project.name}`);
	logger.info(`Project dir: ${dirname(configPath)}`);

	const tasks = buildQualityMatrix(config.scripts);
	writePlanOutputs(tasks);
}

main();
