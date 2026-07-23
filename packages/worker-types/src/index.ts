#!/usr/bin/env node
import { generateWorkerTypesFromFile } from '@nextnode-solutions/infrastructure/worker-types'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const ARGS_START = 2
const DEFAULT_CONFIG = 'nextnode.toml'
const USAGE = 'Usage: worker-types [gen] [--config <path>]'

function resolveConfigPath(args: ReadonlyArray<string>): string {
	const flagIndex = args.indexOf('--config')
	if (flagIndex === -1) return DEFAULT_CONFIG
	const configPath = args[flagIndex + 1]
	if (configPath === undefined || configPath.startsWith('--')) {
		throw new Error(`--config requires a path. ${USAGE}`)
	}
	return configPath
}

function run(): void {
	const args = process.argv.slice(ARGS_START)
	const positional = args.filter(arg => !arg.startsWith('--'))
	if (positional.length > 0 && positional[0] !== 'gen') {
		throw new Error(`Unknown command "${positional[0]}". ${USAGE}`)
	}

	const written = generateWorkerTypesFromFile(resolveConfigPath(args))
	logger.info(
		written.length === 0
			? 'worker-types: no cloudflare-workers target - nothing to generate'
			: `worker-types: generated ${written.length} worker-configuration.d.ts file(s)`,
	)
}

try {
	run()
} catch (error) {
	logger.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}
