/**
 * Forbid a statement whose expression starts with `(`, `[` or a backtick. With
 * `semi: false` the formatter must prepend a leading `;` to such a statement to
 * stop ASI from joining it to the previous line - the `;({ error } = result)`
 * destructuring reassignment and the `;(async () => {})()` statement-position
 * IIFE. The guard is mechanically required by the construct, not a style choice,
 * so oxc drops the empty statement and only the parenthesised expression stays
 * in the AST. Restructure so no guard is needed: destructure with
 * `const { error } = result`, or name and call the function instead of an
 * inline IIFE.
 */
const GUARD_CHARS = new Set(['(', '[', '`'])

export const noLeadingSemicolon = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow statements starting with `(`, `[` or a backtick; under `semi: false` the formatter guards them with a leading `;`',
		},
		messages: {
			leadingSemicolon:
				'This statement starts with `{{char}}`, forcing the formatter to prepend a leading `;` (a destructuring reassignment or a statement-position IIFE). Restructure so none is needed: destructure with `const { x } = y`, or name and call the function instead of an inline IIFE.',
		},
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode ?? context.getSourceCode()
		return {
			ExpressionStatement(node) {
				const [char] = sourceCode.getText(node)
				if (GUARD_CHARS.has(char)) {
					context.report({
						node,
						messageId: 'leadingSemicolon',
						data: { char },
					})
				}
			},
		}
	},
}
