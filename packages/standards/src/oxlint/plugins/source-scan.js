/**
 * Shared raw-text scan for the rules that ban a character everywhere in a file.
 * oxlint's JS plugin API exposes no hook that covers strings, template literals
 * and comments at once, so those rules walk `sourceCode.text` themselves.
 *
 * `pattern` must be a fresh global RegExp per call: `lastIndex` is stateful.
 */
export const reportSourceMatches = (context, pattern, buildReport) => {
	const { text } = context.sourceCode

	let match = pattern.exec(text)
	while (match !== null) {
		const { index } = match
		const before = text.slice(0, index)
		const line = before.split('\n').length
		const column = index - (before.lastIndexOf('\n') + 1)

		context.report({
			...buildReport(match),
			loc: {
				start: { line, column },
				end: { line, column: column + match[0].length },
			},
		})

		match = pattern.exec(text)
	}
}
