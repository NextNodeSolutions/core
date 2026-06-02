import { writeFileSync } from 'node:fs'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

/**
 * Write the rendered docker-bake definition to `path` (an absolute path under
 * the workspace root). The build job runs `docker/bake-action` with
 * `source: .`, so Bake finds it there — no caller-maintained compose file.
 */
export function writeBakeFile(path: string, content: string): void {
	writeFileSync(path, content, 'utf-8')
	logger.info(`Wrote docker-bake definition to ${path}`)
}
