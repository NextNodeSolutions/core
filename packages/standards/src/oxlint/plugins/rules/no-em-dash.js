/**
 * Forbid the em dash anywhere in a source file: strings, template literals and
 * comments included (coding skill quick-reference). Covers the raw character
 * U+2014 and its HTML entity forms (named and numeric, decimal or hex, with an
 * optional trailing semicolon), which all render as the same glyph. Use `-`
 * with spaces or rephrase.
 */
const EM_DASH_SOURCE = '\\u2014|\\x26mdash;?|\\x26#0*8212;?|\\x26#[xX]0*2014;?'

export const noEmDash = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow the em dash (U+2014 and its HTML entities) in source files',
		},
		messages: {
			noEmDash:
				'Em dash is forbidden (U+2014 or its HTML entities). Use `-` with spaces or rephrase.',
		},
		schema: [],
	},
	create(context) {
		return {
			Program(node) {
				const { text } = context.sourceCode
				const pattern = new RegExp(EM_DASH_SOURCE, 'g')

				let match = pattern.exec(text)
				while (match !== null) {
					const { index } = match
					const before = text.slice(0, index)
					const line = before.split('\n').length
					const column = index - (before.lastIndexOf('\n') + 1)

					context.report({
						node,
						messageId: 'noEmDash',
						loc: {
							start: { line, column },
							end: { line, column: column + match[0].length },
						},
					})

					match = pattern.exec(text)
				}
			},
		}
	},
}
