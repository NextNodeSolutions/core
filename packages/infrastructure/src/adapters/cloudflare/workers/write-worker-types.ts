import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

// The consumer's tsconfig picks the file up from the app package root (its
// `include` covers `**/*`), so it replaces the hand-written `env.d.ts`.
const TYPES_FILENAME = 'worker-configuration.d.ts'
// Sits next to the types, listing the keys a local run must supply itself. The
// `.example` suffix is load-bearing: the developer's own `.dev.vars` - real
// local secrets, unrecoverable if overwritten - is never touched.
const DEV_VARS_EXAMPLE_FILENAME = '.dev.vars.example'
const PACKAGE_MANIFEST = 'package.json'

// The app package root the generated types belong to: the nearest ancestor of
// the worker's built entry that holds a package.json. Walking UP from the entry
// path (a lexical walk - the entry lives under `dist/`, which does not exist
// before the build) lands on `apps/<app>` for a monorepo worker.
function resolvePackageDir(entryPath: string): string {
	let dir = dirname(entryPath)
	let parent = dirname(dir)
	while (dir !== parent) {
		if (existsSync(join(dir, PACKAGE_MANIFEST))) return dir
		dir = parent
		parent = dirname(dir)
	}
	if (existsSync(join(dir, PACKAGE_MANIFEST))) return dir
	throw new Error(
		`writeWorkerTypes: found no ${PACKAGE_MANIFEST} above "${entryPath}" - cannot place ${TYPES_FILENAME}`,
	)
}

export interface WriteWorkerTypesInput {
	// Absolute path to the worker's built entry (`main`), resolved against the
	// config dir by the caller. Only its directory is read - the file itself need
	// not exist yet (types are generated before the build).
	readonly entryPath: string
	readonly types: string
	readonly devVarsExample: string
}

// Write one worker's generated files into its app package root and return the
// written paths, so the caller can log which files were generated for which
// service. Both land in the same directory: they describe the same worker, and
// resolving that directory is knowledge this module keeps to itself.
export function writeWorkerTypes(
	input: WriteWorkerTypesInput,
): ReadonlyArray<string> {
	const packageDir = resolvePackageDir(input.entryPath)
	const typesPath = join(packageDir, TYPES_FILENAME)
	const devVarsExamplePath = join(packageDir, DEV_VARS_EXAMPLE_FILENAME)
	writeFileSync(typesPath, input.types)
	writeFileSync(devVarsExamplePath, input.devVarsExample)
	logger.info(
		`Generated ${TYPES_FILENAME} + ${DEV_VARS_EXAMPLE_FILENAME} in ${packageDir}`,
	)
	return [typesPath, devVarsExamplePath]
}
