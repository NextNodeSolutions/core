/**
 * Forbid `enum` declarations - use string literal unions or `as const`
 * objects instead (typescript skill, "Unions Over Enums").
 *
 * Ambient `declare enum` is tolerated: it describes third-party code.
 */
export const noEnum = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow `enum` declarations in favor of literal unions and `as const` objects',
		},
		messages: {
			noEnum: '`enum` is forbidden. Use a string literal union (`type Role = "admin" | "user"`) or an `as const` object instead.',
		},
		schema: [],
	},
	create(context) {
		return {
			TSEnumDeclaration(node) {
				if (node.declare) {
					return
				}

				context.report({
					node,
					messageId: 'noEnum',
				})
			},
		}
	},
}
