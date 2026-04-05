import { appendFileSync } from 'node:fs'

export function writeOutput(key: string, value: string): void {
	const outputFile = process.env['GITHUB_OUTPUT']
	if (!outputFile) {
		throw new Error(
			'GITHUB_OUTPUT env var is not set — are you running in GitHub Actions?',
		)
	}
	appendFileSync(outputFile, `${key}=${value}\n`)
}

export function writeSummary(markdown: string): void {
	const summaryFile = process.env['GITHUB_STEP_SUMMARY']
	if (!summaryFile) {
		throw new Error(
			'GITHUB_STEP_SUMMARY env var is not set — are you running in GitHub Actions?',
		)
	}
	appendFileSync(summaryFile, `${markdown}\n`)
}
