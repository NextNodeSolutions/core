#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { generateWorkerTypesFromFile } from '@nextnode-solutions/infrastructure/worker-types'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const ARGS_START = 2
const USAGE = 'Usage: worker-types [gen] [--config <path>]'

function run(): void {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(ARGS_START),
		options: { config: { type: 'string', default: 'nextnode.toml' } },
		allowPositionals: true,
	})
	if (positionals.length > 0 && positionals[0] !== 'gen') {
		throw new Error(`Unknown command "${positionals[0]}". ${USAGE}`)
	}

	const written = generateWorkerTypesFromFile(values.config)
	logger.info(
		written.length
			? `worker-types: generated ${written.length} worker-configuration.d.ts file(s)`
			: 'worker-types: no cloudflare-workers target - nothing to generate',
	)
}

try {
	run()
} catch (error) {
	logger.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}
