/**
 * Forbid a ternary with an empty-object branch (`cond ? {} : {...}` or its
 * mirror). The `{}` exists only to spread nothing when the guard fails: it is
 * a conditional object spread written the long way. Extract an early-return
 * helper returning `T | undefined` and spread its result instead.
 */
const isEmptyObject = node =>
	node.type === 'ObjectExpression' && node.properties.length === 0

export const noEmptyObjectTernary = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow a ternary with an empty-object branch; extract an early-return helper returning `T | undefined` and spread it',
		},
		messages: {
			emptyObjectTernary:
				'A ternary with an empty-object branch is a conditional spread in disguise. Extract an early-return helper returning `T | undefined` and spread its result instead.',
		},
		schema: [],
	},
	create(context) {
		return {
			ConditionalExpression(node) {
				if (
					isEmptyObject(node.consequent) ||
					isEmptyObject(node.alternate)
				) {
					context.report({
						node,
						messageId: 'emptyObjectTernary',
					})
				}
			},
		}
	},
}
