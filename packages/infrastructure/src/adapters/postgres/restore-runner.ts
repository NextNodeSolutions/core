import { spawnSync } from 'node:child_process'

import { redactPostgresPassword } from '#/domain/services/postgres.ts'

export interface PgRestoreOptions {
	readonly databaseUrl: string
	readonly dumpPath: string
}

/**
 * Spawn `pg_restore` to load `dumpPath` into `databaseUrl`. Uses the
 * custom-archive flags emitted by `eeshugerman/postgres-backup-s3`
 * (`pg_dump -Fc`), so:
 *
 *   --clean --if-exists  drop existing objects before recreate, idempotent
 *   --no-owner --no-acl  ignore source ownership + grants (the target
 *                         role may differ, especially across embedded
 *                         resets vs. external DBs).
 *
 * The DATABASE_URL is split so the password rides on `PGPASSWORD` (the
 * libpq env var) and the rest of the URL goes through `--dbname`.
 * Passing the password via argv would expose it in `ps aux` and
 * `/proc/<pid>/cmdline` to any local user on the host.
 *
 * `stdio: 'inherit'` streams pg_restore's progress + errors straight to
 * the parent — restore is operator-driven and the operator wants the
 * raw output. Returns on exit code 0, throws otherwise so the cli
 * command surfaces the failure with a non-zero exit. `spawnSync` over
 * `spawn` keeps the surface tiny: there is nothing to do in parallel
 * with pg_restore, the parent is the operator's terminal, and we want
 * a synchronous "done / failed" answer at the end.
 */
export function runPgRestore(options: PgRestoreOptions): void {
	const { urlWithoutPassword, password } = redactPostgresPassword(
		options.databaseUrl,
	)
	const result = spawnSync(
		'pg_restore',
		[
			'--dbname',
			urlWithoutPassword,
			'--clean',
			'--if-exists',
			'--no-owner',
			'--no-acl',
			options.dumpPath,
		],
		{
			stdio: 'inherit',
			env: { ...process.env, PGPASSWORD: password },
		},
	)
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(
			`pg_restore exited with code ${String(result.status)} (target db rejected the dump)`,
		)
	}
}
