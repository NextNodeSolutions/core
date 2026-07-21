/**
 * Forbid a ternary with an empty-object branch (`cond ? {} : {...}` or its
 * mirror). The `{}` exists only to spread nothing when the guard fails: it is
 * a conditional object spread written the long way. Fold it into the target
 * literal with `...(cond && { ... })` instead.
 */
const isEmptyObject = node =>
	node.type === 'ObjectExpression' && node.properties.length === 0

export const noEmptyObjectTernary = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow a ternary with an empty-object branch; fold it into a conditional spread `...(cond && { ... })`',
		},
		messages: {
			emptyObjectTernary:
				'A ternary with an empty-object branch is a conditional spread in disguise. Use `...(cond && { ... })` inside the object literal instead.',
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
