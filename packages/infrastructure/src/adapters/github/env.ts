import { appendFileSync } from 'node:fs'

// Public values only: a secret never goes through GITHUB_ENV, where every later
// step of the job would inherit it.
export function writeEnvVar(key: string, envValue: string): void {
	const envFile = process.env['GITHUB_ENV']
	if (!envFile) {
		throw new Error(
			'GITHUB_ENV env var is not set - are you running in GitHub Actions?',
		)
	}
	appendFileSync(envFile, `${key}=${envValue}\n`)
}
