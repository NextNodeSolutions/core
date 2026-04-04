/**
 * Custom oxlint plugin that forbids `as` type assertions except `as const`.
 *
 * Rationale: `as` assertions bypass the type checker and hide type errors.
 * Use type guards, `satisfies`, or refine your types instead.
 */

const noTypeAssertion = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow `as` type assertions except `as const`',
		},
		messages: {
			noTypeAssertion:
				'Type assertion with `as` is forbidden. Use type guards, `satisfies`, or refine your types instead. Only `as const` is allowed.',
		},
		schema: [],
	},
	create(context) {
		return {
			TSAsExpression(node) {
				const typeAnnotation = node.typeAnnotation

				const isAsConst =
					typeAnnotation.type === 'TSTypeReference' &&
					typeAnnotation.typeName?.type === 'Identifier' &&
					typeAnnotation.typeName.name === 'const'

				if (isAsConst) {
					return
				}

				context.report({
					node,
					messageId: 'noTypeAssertion',
				})
			},
		}
	},
}

const plugin = {
	meta: {
		name: 'nextnode',
	},
	rules: {
		'no-type-assertion': noTypeAssertion,
	},
}

export default plugin
