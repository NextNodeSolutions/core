import { appendFileSync } from 'node:fs'

export function writeEnvVar(key: string, value: string): void {
	const envFile = process.env['GITHUB_ENV']
	if (!envFile) {
		throw new Error(
			'GITHUB_ENV env var is not set — are you running in GitHub Actions?',
		)
	}
	appendFileSync(envFile, `${key}=${value}\n`)
}

/**
 * Write a secret env var: emit `::add-mask::<value>` on stdout so GitHub
 * Actions redacts the value from every subsequent log line, then append
 * `KEY=value` to GITHUB_ENV so later steps in the same job inherit it.
 *
 * Mask MUST be emitted before the value can leak; calling writeEnvVar for
 * a secret skips the mask and is a leak.
 */
export function writeSecret(key: string, value: string): void {
	process.stdout.write(`::add-mask::${value}\n`)
	writeEnvVar(key, value)
}
