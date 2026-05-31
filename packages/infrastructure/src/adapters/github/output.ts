import { appendFileSync } from 'node:fs'

// Heredoc delimiter for multiline GITHUB_OUTPUT entries. GitHub Actions only
// captures a single line for the `key=value` form, so multiline values use the
// documented `key<<DELIMITER … DELIMITER` block instead.
const MULTILINE_DELIMITER = 'GHA_OUTPUT_EOF'

function requireOutputFile(): string {
	const outputFile = process.env['GITHUB_OUTPUT']
	if (!outputFile) {
		throw new Error(
			'GITHUB_OUTPUT env var is not set — are you running in GitHub Actions?',
		)
	}
	return outputFile
}

export function writeOutput(key: string, value: string): void {
	appendFileSync(requireOutputFile(), `${key}=${value}\n`)
}

/**
 * Append a multiline output using the GitHub Actions heredoc form so newlines
 * survive (the plain `key=value` form is truncated at the first newline). Use
 * for values like the docker bake `set:` block that span several lines.
 */
export function writeMultilineOutput(key: string, value: string): void {
	if (value.includes(MULTILINE_DELIMITER)) {
		throw new Error(
			`Cannot write multiline output "${key}": value collides with the heredoc delimiter "${MULTILINE_DELIMITER}"`,
		)
	}
	appendFileSync(
		requireOutputFile(),
		`${key}<<${MULTILINE_DELIMITER}\n${value}\n${MULTILINE_DELIMITER}\n`,
	)
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
