import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveDocumentPaths } from './config-paths.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'

const CONFIG_FILENAME = 'wrangler.json'
const JSON_INDENT = 2

// Write `document`'s generated config to an ephemeral JSON file (paths
// absolutised against `cwd`), run `run` against its path, and remove the file in
// `finally` - it is never committed. `prefix` names the scratch dir per command.
export async function withWranglerConfig<T>(
	document: WranglerDocument,
	cwd: string,
	prefix: string,
	run: (configPath: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), prefix))
	const configPath = join(dir, CONFIG_FILENAME)
	try {
		await writeFile(
			configPath,
			JSON.stringify(
				resolveDocumentPaths(document, cwd),
				null,
				JSON_INDENT,
			),
		)
		return await run(configPath)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}
