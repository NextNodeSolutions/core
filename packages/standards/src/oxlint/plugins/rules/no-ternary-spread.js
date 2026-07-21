/**
 * Forbid spreading a ternary whose alternate is a nullish sentinel
 * (`...(cond ? value : undefined)` / `...(cond ? value : null)`). In spread
 * position `{ ...undefined }` and `{ ...false }` are both no-ops, so the short
 * `...(cond && value)` says exactly the same thing. Scoped to spreads: outside a
 * spread `cond && value` would yield `false` instead of `undefined`.
 */
const isNullish = node =>
	(node.type === 'Literal' && node.value === null) ||
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void')

export const noTernarySpread = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'In a spread, prefer `...(cond && value)` over `...(cond ? value : undefined)`',
		},
		messages: {
			ternarySpread:
				'A spread of `cond ? value : nullish` is a conditional spread written long. Use `...(cond && value)` instead.',
		},
		schema: [],
	},
	create(context) {
		return {
			SpreadElement(node) {
				const { argument } = node
				if (argument.type !== 'ConditionalExpression') {
					return
				}
				if (isNullish(argument.alternate)) {
					context.report({
						node: argument,
						messageId: 'ternarySpread',
					})
				}
			},
		}
	},
}
