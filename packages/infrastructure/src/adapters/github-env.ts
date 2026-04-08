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
