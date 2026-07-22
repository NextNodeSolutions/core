import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import { resolvePackageDir } from './package-dir.ts'

const logger = createLogger()

// The consumer's tsconfig picks the file up from the app package root (its
// `include` covers `**/*`), so it replaces the hand-written `env.d.ts`.
const TYPES_FILENAME = 'worker-configuration.d.ts'

export interface WriteWorkerTypesInput {
	// Absolute path to the worker's built entry (`main`), resolved against the
	// config dir by the caller. Only its directory is read - the file itself need
	// not exist yet (types are generated before the build).
	readonly entryPath: string
	readonly content: string
}

// Write one worker's `worker-configuration.d.ts` into its app package root and
// return the written path. Returns the path so the caller can log which file was
// generated for which service.
export function writeWorkerTypes(input: WriteWorkerTypesInput): string {
	const packageDir = resolvePackageDir(input.entryPath)
	const target = join(packageDir, TYPES_FILENAME)
	writeFileSync(target, input.content)
	logger.info(`Generated ${TYPES_FILENAME} in ${packageDir}`)
	return target
}
