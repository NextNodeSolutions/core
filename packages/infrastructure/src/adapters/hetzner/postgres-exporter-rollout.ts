import {
	POSTGRES_EXPORTER_INIT_FILENAME,
	renderPostgresExporterBootstrapSql,
} from '#/domain/services/postgres-exporter.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { PostgresServiceConfig } from '#/config/types.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

export interface PostgresExporterRolloutInput {
	readonly postgres: PostgresServiceConfig | undefined
	readonly secrets: Readonly<Record<string, string>>
}

/**
 * Write the postgres-exporter bootstrap SQL next to compose.yaml for an
 * EMBEDDED postgres deploy: mounted into /docker-entrypoint-initdb.d, it
 * creates the pg_monitor `postgres_exporter` role on first initdb. The
 * role password reuses POSTGRES_PASSWORD - same .env, same containers,
 * no extra secret surface (see buildEmbeddedPostgresExporterSidecar).
 */
export async function writePostgresExporterFiles(
	session: SshSession,
	envDir: string,
	input: PostgresExporterRolloutInput,
): Promise<void> {
	if (input.postgres?.mode !== 'embedded') return

	const password = input.secrets['POSTGRES_PASSWORD']
	if (password === undefined || password === '') {
		throw new Error(
			'postgres-exporter: "POSTGRES_PASSWORD" must be present in the secret pool to bootstrap the monitoring role',
		)
	}

	await session.writeFile(
		`${envDir}/${POSTGRES_EXPORTER_INIT_FILENAME}`,
		renderPostgresExporterBootstrapSql(password),
	)
	logger.info('postgres-exporter bootstrap SQL written')
}
