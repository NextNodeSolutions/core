import { dirname } from "node:path";
import { logger } from "@nextnode-solutions/logger";
import { loadConfig } from "./config/load.js";
import { buildQualityMatrix } from "./pipeline/quality.js";
import { writePlanOutputs } from "./pipeline/plan.js";

const VALID_ACTIONS: ReadonlySet<string> = new Set(["plan"]);

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
	const projectDir = dirname(configPath);

	logger.info(`Project: ${config.project.name} (${config.project.type})`);
	logger.info(`Project dir: ${projectDir}`);

	const tasks = buildQualityMatrix(config.scripts);
	writePlanOutputs({ config, tasks });
}

main();
