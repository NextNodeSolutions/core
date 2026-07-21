/**
 * Forbid `return <cond> ? <a> : <b>` when one branch is a nullish sentinel
 * (`null` or `undefined`). Such a ternary is a guard clause in disguise:
 * `return row === undefined ? null : parse(row)` should be an early return
 * `if (row === undefined) return null` followed by the real work.
 */
const isNullish = node =>
	(node.type === 'Literal' && node.value === null) ||
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void')

export const noNullishTernaryReturn = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow returning a ternary whose branch is null/undefined; use an early return guard instead',
		},
		messages: {
			nullishTernaryReturn:
				'A ternary returning null/undefined is a guard clause in disguise. Use an early return: `if (cond) return null` then return the real value.',
		},
		schema: [],
	},
	create(context) {
		return {
			ReturnStatement(node) {
				const { argument } = node
				if (argument?.type !== 'ConditionalExpression') {
					return
				}

				if (
					isNullish(argument.consequent) ||
					isNullish(argument.alternate)
				) {
					context.report({
						node: argument,
						messageId: 'nullishTernaryReturn',
					})
				}
			},
		}
	},
}
