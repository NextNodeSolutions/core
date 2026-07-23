/**
 * Forbid comparing a `.length` against `0` with `===` / `!==`; use a truthy
 * check. `.length` is always a non-negative integer, so `!x.length` is exactly
 * `x.length === 0` and `x.length` is exactly `x.length !== 0`.
 *
 * Exempt: an optional-chained length (`x?.length === 0`). There the access is
 * `number | undefined`, and the truthy rewrite is not equivalent - `!x?.length`
 * is also true when `x` is missing, `x?.length === 0` is not. Only a plain,
 * non-optional `.length` fires.
 */
const isPlainLengthAccess = node =>
	node?.type === 'MemberExpression' &&
	node.computed === false &&
	node.optional !== true &&
	node.property.type === 'Identifier' &&
	node.property.name === 'length'

const isZero = node =>
	node?.type === 'Literal' &&
	typeof node.value === 'number' &&
	node.value === 0

export const noLengthZeroComparison = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow `x.length === 0` / `x.length !== 0`; use a truthy check `!x.length` / `x.length`. Exempt when the length is optional-chained.',
		},
		messages: {
			lengthZeroComparison:
				'Compare emptiness with a truthy check instead: `!x.length` for `x.length === 0`, `x.length` for `x.length !== 0`.',
		},
		schema: [],
	},
	create(context) {
		return {
			BinaryExpression(node) {
				if (node.operator !== '===' && node.operator !== '!==') {
					return
				}
				const flags =
					(isPlainLengthAccess(node.left) && isZero(node.right)) ||
					(isPlainLengthAccess(node.right) && isZero(node.left))
				if (!flags) return

				context.report({
					node,
					messageId: 'lengthZeroComparison',
				})
			},
		}
	},
}
