import { randomUUID } from 'node:crypto'
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

/**
 * Register a value with the runner's log masker. `::add-mask::` is line-based,
 * so a multi-line secret (a PEM key) is masked line by line - masking it as a
 * whole would leave every line after the first readable in the logs.
 */
export function maskSecret(secretValue: string): void {
	for (const line of secretValue.split(/\r?\n/)) {
		if (line.trim()) process.stdout.write(`::add-mask::${line}\n`)
	}
}

/**
 * Write a secret as a step output: mask it first (the mask MUST be emitted
 * before the value can leak), then append it in the delimiter form so a
 * multi-line value survives. Unlike GITHUB_ENV, an output reaches only the
 * steps that reference it explicitly.
 */
export function writeSecretOutput(key: string, secretValue: string): void {
	maskSecret(secretValue)
	const delimiter = `nextnode_${randomUUID()}`
	appendFileSync(
		requireOutputFile(),
		`${key}<<${delimiter}\n${secretValue}\n${delimiter}\n`,
	)
}

// A warning annotation: shown on the run summary, not only in the step log.
export function writeWarning(message: string): void {
	process.stdout.write(`::warning::${message}\n`)
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
