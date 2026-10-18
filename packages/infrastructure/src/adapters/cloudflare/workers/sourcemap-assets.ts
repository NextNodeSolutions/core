import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

async function removeMapFiles(directory: string): Promise<number> {
	const entries = await readdir(directory, { withFileTypes: true })
	const removed = await Promise.all(
		entries.map(async entry => {
			const path = join(directory, entry.name)
			if (entry.isDirectory()) return removeMapFiles(path)
			if (!entry.isFile() || !entry.name.endsWith('.map')) return 0
			await unlink(path)
			return 1
		}),
	)
	return removed.reduce((total, count) => total + count, 0)
}

/**
 * Delete every `.map` file from a service's static-assets directory
 * (`<projectDir>/<assetsDirectory>`) right before its assets are uploaded. A
 * source map holds the original source code, and anything left in the assets
 * directory is served publicly.
 */
export async function removeSourcemapAssets(
	projectDir: string,
	assetsDirectory: string,
): Promise<void> {
	const directory = join(projectDir, assetsDirectory)
	const removed = await removeMapFiles(directory)
	if (removed)
		logger.info(`removed ${removed} source map(s) from ${directory}`)
}
