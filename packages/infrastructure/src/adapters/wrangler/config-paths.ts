import { isAbsolute, resolve } from 'node:path'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'

function absolutise(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path)
}

function resolveAssetsPath(
	assets: WranglerDocument['assets'],
	cwd: string,
): Pick<WranglerDocument, 'assets'> | undefined {
	if (!assets) return undefined
	return {
		assets: { ...assets, directory: absolutise(assets.directory, cwd) },
	}
}

function resolveD1Paths(
	databases: WranglerDocument['d1_databases'],
	cwd: string,
): Pick<WranglerDocument, 'd1_databases'> | undefined {
	if (!databases) return undefined
	return {
		d1_databases: databases.map(database =>
			typeof database.migrations_dir === 'undefined'
				? database
				: {
						...database,
						migrations_dir: absolutise(
							database.migrations_dir,
							cwd,
						),
					},
		),
	}
}

/**
 * Absolutise every filesystem path a generated wrangler config carries (`main`,
 * `assets.directory`, each `d1_databases[].migrations_dir`) against the project
 * dir. wrangler resolves these relative to the CONFIG file's directory, but the
 * config is written to an ephemeral temp dir that holds neither the built bundle
 * nor the migrations - so they must be absolute. wrangler accepts absolute
 * paths, and an already-absolute path is left untouched.
 */
export function resolveDocumentPaths(
	document: WranglerDocument,
	cwd: string,
): WranglerDocument {
	return {
		...document,
		main: absolutise(document.main, cwd),
		...resolveAssetsPath(document.assets, cwd),
		...resolveD1Paths(document.d1_databases, cwd),
	}
}
