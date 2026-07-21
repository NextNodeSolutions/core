/**
 * Forbid comparing against `undefined` with `===` / `!==` (including `void 0`).
 * A truthy check says the same thing for the common case: `!x` for
 * `x === undefined`, `x` for `x !== undefined`. Only `undefined` is targeted,
 * not `null` (`node.value === null`-style checks that must distinguish the null
 * literal from other falsy values stay legal).
 */
const isUndefined = node =>
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void')

export const noUndefinedComparison = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow `=== undefined` / `!== undefined`; use a truthy check `!x` / `x`',
		},
		messages: {
			undefinedComparison:
				'Compare with a truthy check instead: `!x` for `x === undefined`, `x` for `x !== undefined`.',
		},
		schema: [],
	},
	create(context) {
		return {
			BinaryExpression(node) {
				if (node.operator !== '===' && node.operator !== '!==') {
					return
				}
				if (isUndefined(node.left) || isUndefined(node.right)) {
					context.report({
						node,
						messageId: 'undefinedComparison',
					})
				}
			},
		}
	},
}
