import { writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import type { GuardFile } from '../../domain/deploy/seo-guard.ts'

const logger = createLogger()

function assertSafeFilename(filename: string, buildDirectory: string): void {
	if (filename === '' || filename.includes('\0')) {
		throw new Error(`injectFiles: invalid filename "${filename}"`)
	}
	if (isAbsolute(filename)) {
		throw new Error(
			`injectFiles: filename must be relative, got "${filename}"`,
		)
	}
	const target = join(buildDirectory, filename)
	const rel = relative(buildDirectory, target)
	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(
			`injectFiles: "${filename}" resolves outside build directory "${buildDirectory}"`,
		)
	}
}

export function injectFiles(
	buildDirectory: string,
	files: ReadonlyArray<GuardFile>,
): void {
	for (const file of files) {
		assertSafeFilename(file.filename, buildDirectory)
		const path = join(buildDirectory, file.filename)
		writeFileSync(path, file.content)
		logger.info(`Injected ${file.filename} into ${buildDirectory}`)
	}
}
