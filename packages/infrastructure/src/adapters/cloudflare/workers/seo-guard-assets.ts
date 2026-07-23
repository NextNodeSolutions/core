import { writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { computeSeoGuardFiles } from '#/domain/deploy/seo-guard.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { GuardFile } from '#/domain/deploy/seo-guard.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

// Mirrors adapters/build-output/inject-files' safety check. Kept local to the
// cloudflare/workers adapter rather than importing build-output: a cross-adapter
// call is banned, and the write is a generic, guarded fs primitive whose small
// duplication buys the cloisonnement.
function assertSafeFilename(filename: string, directory: string): void {
	if (filename === '' || filename.includes('\0')) {
		throw new Error(`seo-guard: invalid filename "${filename}"`)
	}
	if (isAbsolute(filename)) {
		throw new Error(
			`seo-guard: filename must be relative, got "${filename}"`,
		)
	}
	const rel = relative(directory, join(directory, filename))
	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(
			`seo-guard: "${filename}" resolves outside "${directory}"`,
		)
	}
}

/**
 * Inject the non-prod SEO guard (`_headers` + `robots.txt`) into a service's
 * static-assets directory (`<projectDir>/<assetsDirectory>`) right before its
 * assets are uploaded, so a non-prod deployment is not indexable. In production
 * `computeSeoGuardFiles` returns no files and nothing is written. Called per
 * routed/asset-shipping service so EVERY worker with assets is guarded, not only
 * the primary one.
 */
export function injectSeoGuardAssets(
	projectDir: string,
	assetsDirectory: string,
	environment: AppEnvironment,
): void {
	const files: ReadonlyArray<GuardFile> = computeSeoGuardFiles(environment)
	if (!files.length) return

	const directory = join(projectDir, assetsDirectory)
	for (const file of files) {
		assertSafeFilename(file.filename, directory)
		writeFileSync(join(directory, file.filename), file.content)
		logger.info(`SEO guard: injected ${file.filename} into ${directory}`)
	}
}
