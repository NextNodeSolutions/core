import { writeFileSync } from 'node:fs'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

/**
 * Write the rendered docker-bake definition to `path` (an absolute path under
 * the repo root, the bake-action working directory). The build job then points
 * `docker/bake-action`'s `files:` at it — no caller-maintained compose file.
 */
export function writeBakeFile(path: string, content: string): void {
	writeFileSync(path, content)
	logger.info(`Wrote docker-bake definition to ${path}`)
}
