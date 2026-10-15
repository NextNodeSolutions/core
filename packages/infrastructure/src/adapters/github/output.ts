import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

// GITHUB_OUTPUT (step outputs) or GITHUB_ENV (env of the job's later steps).
function requireRunnerFile(variable: 'GITHUB_OUTPUT' | 'GITHUB_ENV'): string {
	const runnerFile = process.env[variable]
	if (!runnerFile) {
		throw new Error(
			`${variable} env var is not set - are you running in GitHub Actions?`,
		)
	}
	return runnerFile
}

// The delimiter form of a runner file entry, so a multi-line value survives.
function delimitedEntry(key: string, entryValue: string): string {
	const delimiter = `nextnode_${randomUUID()}`
	return `${key}<<${delimiter}\n${entryValue}\n${delimiter}\n`
}

export function writeOutput(key: string, outputValue: string): void {
	appendFileSync(
		requireRunnerFile('GITHUB_OUTPUT'),
		`${key}=${outputValue}\n`,
	)
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
 * before the value can leak), then append it in the delimiter form. Unlike
 * GITHUB_ENV, an output reaches only the steps that reference it explicitly.
 */
export function writeSecretOutput(key: string, secretValue: string): void {
	maskSecret(secretValue)
	appendFileSync(
		requireRunnerFile('GITHUB_OUTPUT'),
		delimitedEntry(key, secretValue),
	)
}

/**
 * Export a secret as an env var of every later step of the job, masked first.
 * For the build job only, whose later steps are the caller's build.
 */
export function writeSecretEnv(key: string, secretValue: string): void {
	maskSecret(secretValue)
	appendFileSync(
		requireRunnerFile('GITHUB_ENV'),
		delimitedEntry(key, secretValue),
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
