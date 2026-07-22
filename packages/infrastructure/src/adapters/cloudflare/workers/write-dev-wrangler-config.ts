import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import { resolvePackageDir } from './package-dir.ts'

const logger = createLogger()

// `wrangler dev` auto-detects `wrangler.jsonc` in the worker's package root; the
// deploy path passes its own ephemeral `--config`, so this committed file only
// ever governs local dev.
const CONFIG_FILENAME = 'wrangler.jsonc'

export interface WriteDevWranglerConfigInput {
	// Absolute path to the worker's entry, resolved against the config dir by the
	// caller. Only its directory is read.
	readonly entryPath: string
	readonly content: string
}

// Write one worker's dev `wrangler.jsonc` into its app package root and return
// the written path.
export function writeDevWranglerConfig(
	input: WriteDevWranglerConfigInput,
): string {
	const packageDir = resolvePackageDir(input.entryPath)
	const target = join(packageDir, CONFIG_FILENAME)
	writeFileSync(target, input.content)
	logger.info(`Generated ${CONFIG_FILENAME} in ${packageDir}`)
	return target
}
