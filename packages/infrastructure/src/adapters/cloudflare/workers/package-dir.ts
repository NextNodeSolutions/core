import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PACKAGE_MANIFEST = 'package.json'

// The app package root a generated file belongs to: the nearest ancestor of the
// worker's entry that holds a package.json. A lexical walk UP from the entry (the
// built entry lives under `dist/`, absent before the build) lands on
// `apps/<app>` for a monorepo worker.
export function resolvePackageDir(entryPath: string): string {
	let dir = dirname(entryPath)
	let parent = dirname(dir)
	while (dir !== parent) {
		if (existsSync(join(dir, PACKAGE_MANIFEST))) return dir
		dir = parent
		parent = dirname(dir)
	}
	if (existsSync(join(dir, PACKAGE_MANIFEST))) return dir
	throw new Error(
		`resolvePackageDir: found no ${PACKAGE_MANIFEST} above "${entryPath}"`,
	)
}
