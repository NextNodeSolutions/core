import { appendFileSync } from 'node:fs'

function requireOutputFile(): string {
	const outputFile = process.env['GITHUB_OUTPUT']
	if (!outputFile) {
		throw new Error(
			'GITHUB_OUTPUT env var is not set - are you running in GitHub Actions?',
		)
	}
	return outputFile
}

export function writeOutput(key: string, outputValue: string): void {
	appendFileSync(requireOutputFile(), `${key}=${outputValue}\n`)
}

export function writeSummary(markdown: string): void {
	const summaryFile = process.env['GITHUB_STEP_SUMMARY']
	if (!summaryFile) {
		throw new Error(
			'GITHUB_STEP_SUMMARY env var is not set - are you running in GitHub Actions?',
		)
	}
	appendFileSync(summaryFile, `${markdown}\n`)
}
