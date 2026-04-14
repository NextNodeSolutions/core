import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import type { GuardFile } from '../../domain/deploy/seo-guard.ts'

const logger = createLogger()

export function injectFiles(
	buildDirectory: string,
	files: ReadonlyArray<GuardFile>,
): void {
	for (const file of files) {
		const path = join(buildDirectory, file.filename)
		writeFileSync(path, file.content)
		logger.info(`Injected ${file.filename} into ${buildDirectory}`)
	}
}
