import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import {
	POSTGRES_EXPORTER_INIT_FILENAME,
	POSTGRES_EXPORTER_INIT_MOUNT_PATH,
	renderPostgresExporterBootstrapSql,
} from '#/domain/services/postgres-exporter.ts'
import { POSTGRES_SIDECAR_SERVICE_NAME } from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { shellEscape } from './ssh/shell-escape.ts'

import type { PostgresServiceConfig } from '#/config/service-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
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
	if (typeof password === 'undefined' || password === '') {
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

export interface PostgresExporterRoleInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly postgres: PostgresServiceConfig | undefined
}

/**
 * Re-run the bootstrap SQL inside the healthy postgres container on EVERY
 * deploy. The initdb.d mount only fires on a fresh volume's first boot, so
 * a stack whose volume predates the exporter feature (or a rotated
 * POSTGRES_PASSWORD) never converges through that channel - this exec is
 * the self-healing path. The SQL is convergent (guarded CREATE +
 * unconditional ALTER), so re-execution is free on an already-correct
 * stack. Must run after `bringUpDb` gated the container healthy.
 */
export async function ensurePostgresExporterRole(
	session: SshSession,
	input: PostgresExporterRoleInput,
): Promise<void> {
	if (input.postgres?.mode !== 'embedded') return

	const silo = computeSilo(input.projectName, input.environment)
	const composeFileQ = shellEscape(
		`/opt/apps/${input.projectName}/${input.environment}/compose.yaml`,
	)
	await session.exec(
		`docker compose -p ${shellEscape(silo.id)} -f ${composeFileQ} exec -T ${POSTGRES_SIDECAR_SERVICE_NAME} sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f ${POSTGRES_EXPORTER_INIT_MOUNT_PATH}'`,
	)
	logger.info('postgres-exporter role converged')
}
