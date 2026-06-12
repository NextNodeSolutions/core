/**
 * Forbid the em dash character U+2014 anywhere in a source file: strings,
 * template literals and comments included (coding skill quick-reference).
 * Use `-` with spaces or rephrase.
 */
const EM_DASH = '\u2014'

export const noEmDash = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow the em dash character (U+2014) in source files',
		},
		messages: {
			noEmDash:
				'Em dash character (U+2014) is forbidden. Use `-` with spaces or rephrase.',
		},
		schema: [],
	},
	create(context) {
		return {
			Program(node) {
				const { text } = context.sourceCode

				let index = text.indexOf(EM_DASH)
				while (index !== -1) {
					const before = text.slice(0, index)
					const line = before.split('\n').length
					const column = index - (before.lastIndexOf('\n') + 1)

					context.report({
						node,
						messageId: 'noEmDash',
						loc: {
							start: { line, column },
							end: { line, column: column + 1 },
						},
					})

					index = text.indexOf(EM_DASH, index + 1)
				}
			},
		}
	},
}
