import { execFile } from 'node:child_process'

import { buildPlanetscaleDatabaseUrl } from '#/domain/cloudflare/workers/planetscale.ts'

import type { ExecFileException } from 'node:child_process'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { MigrateResult } from '#/domain/deploy/target.ts'

const MS_PER_SECOND = 1_000
const MIGRATION_TIMEOUT_SECONDS = 900
const MIGRATION_TIMEOUT_MS = MIGRATION_TIMEOUT_SECONDS * MS_PER_SECOND
const MAX_REPORTED_OUTPUT_CHARS = 2_000

function redactSecrets(text: string, secrets: readonly string[]): string {
	let redacted = text
	for (const secret of secrets) {
		if (secret) redacted = redacted.split(secret).join('[redacted]')
	}
	return redacted
}

function truncateOutput(text: string): string {
	if (text.length <= MAX_REPORTED_OUTPUT_CHARS) return text
	return `${text.slice(0, MAX_REPORTED_OUTPUT_CHARS)}\n[truncated]`
}

function exitReason(error: ExecFileException): string {
	if (error.killed) return `timed out after ${MIGRATION_TIMEOUT_SECONDS}s`
	if (typeof error.code === 'number') return `exit code ${error.code}`
	if (typeof error.code === 'string') return `could not start (${error.code})`
	if (error.signal) return `terminated by ${error.signal}`
	return 'no exit code reported'
}

type MigrationFailure = {
	readonly error: ExecFileException
	readonly command: string
	readonly databaseUrl: string
	readonly password: string
	readonly stdout: string
	readonly stderr: string
}

function migrationFailure(failure: MigrationFailure): Error {
	const secrets = [failure.databaseUrl, failure.password]
	const sections = [
		`PlanetScale migration failed (command: ${failure.command}, ${exitReason(failure.error)}).`,
	]
	for (const [name, output] of [
		['stdout', failure.stdout] as const,
		['stderr', failure.stderr] as const,
	]) {
		const trimmed = output.trim()
		if (!trimmed) continue
		sections.push(
			`${name}:\n${truncateOutput(redactSecrets(trimmed, secrets))}`,
		)
	}
	return new Error(sections.join('\n\n'))
}

export async function migratePlanetscale(
	credentials: WorkersTerraformOutputs['planetscaleMigrator'],
	command: string,
	projectDir: string,
): Promise<MigrateResult> {
	if (!credentials)
		throw new Error(
			'PlanetScale migrator outputs are missing. Run provision before migrate-remote.',
		)
	const databaseUrl = buildPlanetscaleDatabaseUrl(credentials)
	const startedAt = Date.now()
	await new Promise<void>((resolve, reject) => {
		execFile(
			'/bin/sh',
			['-c', command],
			{
				cwd: projectDir,
				env: { ...process.env, DATABASE_URL: databaseUrl },
				timeout: MIGRATION_TIMEOUT_MS,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve()
					return
				}
				reject(
					migrationFailure({
						error,
						command,
						databaseUrl,
						password: credentials.password,
						stdout,
						stderr,
					}),
				)
			},
		)
	})
	return { durationMs: Date.now() - startedAt }
}
