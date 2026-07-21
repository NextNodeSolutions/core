/**
 * Select the BACKING-service secrets (those a `Service` produced, identified via
 * `origins`) for the shared `.env` the embedded-postgres sidecar
 * (`env_file: ['.env']`), the backup sidecar (`${VAR}` compose interpolation),
 * and the ephemeral migrate container (`--env-file .env`) read. User secrets are
 * excluded on purpose: the DB/backup/migrate infra needs `DATABASE_URL`,
 * `POSTGRES_PASSWORD`, `R2_*` - never the app's `SESSION_KEY`.
 */
export function selectBackingSecrets(
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(secrets).filter(([key]) => origins[key] !== undefined),
	)
}
