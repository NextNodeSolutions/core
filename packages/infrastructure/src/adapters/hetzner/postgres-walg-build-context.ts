import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { POSTGRES_WALG_BUILD_DIR } from '#/domain/services/postgres-walg.ts'

import { shellEscape } from './ssh/shell-escape.ts'

import type { SshSession } from './ssh/session.types.ts'

// The build context (Dockerfile + scripts) is co-located with this module, so
// it ships inside the package and is present in the deploy's (sparse) .infra
// checkout - resolving via repo-root paths failed there (images/ not checked
// out). Resolved from THIS source file so the deploy + tests read it unmocked.
const CONTEXT_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'postgres-walg-context',
)

const CONTEXT_FILES = [
	'Dockerfile',
	'entrypoint-walg.sh',
	'walg-backup-loop.sh',
] as const

/**
 * Ship the postgres+wal-g build context (Dockerfile + entrypoint + backup loop)
 * to the VPS, next to compose.yaml, so `docker compose build` builds the image
 * LOCALLY on the VPS - no container registry, no pull authentication, no public
 * package. Only the public `postgres:18` base is pulled. Call for embedded
 * postgres only.
 */
export async function writePostgresWalgBuildContext(
	session: SshSession,
	envDir: string,
): Promise<void> {
	const dir = `${envDir}/${POSTGRES_WALG_BUILD_DIR}`
	await session.exec(`mkdir -p ${shellEscape(dir)}`)
	await Promise.all(
		CONTEXT_FILES.map(name =>
			session.writeFile(
				`${dir}/${name}`,
				readFileSync(resolve(CONTEXT_DIR, name), 'utf8'),
			),
		),
	)
}
