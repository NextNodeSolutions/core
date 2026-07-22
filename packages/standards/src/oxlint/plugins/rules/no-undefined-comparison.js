/**
 * Forbid comparing against `undefined` with `===` / `!==` (including `void 0`).
 * A truthy check says the same thing for the common case: `!x` for
 * `x === undefined`, `x` for `x !== undefined`. Only `undefined` is targeted,
 * not `null` (`node.value === null`-style checks that must distinguish the null
 * literal from other falsy values stay legal).
 *
 * Exempt: narrowing an indexed access. Under `noUncheckedIndexedAccess`,
 * `collection[i]` is `T | undefined`, and a truthy check is falsy-unsafe (it
 * rejects a present `0` / `''` / `false`). The only assertion-free narrow is a
 * value check, so `collection[i] === undefined` and a binding taken from an
 * indexed access (`const first = collection[0]; first === undefined`) are both
 * allowed. Plain property access (`obj.prop === undefined`) is not indexed and
 * still fires.
 */
const isUndefined = node =>
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void')

const isIndexedAccess = node =>
	node?.type === 'MemberExpression' && node.computed === true

const resolveVariable = (sourceCode, identifier) => {
	let scope = sourceCode.getScope(identifier)
	while (scope) {
		const reference = scope.references.find(
			ref => ref.identifier === identifier,
		)
		if (reference) return reference.resolved
		scope = scope.upper
	}
	return null
}

const isIndexedBinding = (sourceCode, identifier) => {
	const variable = resolveVariable(sourceCode, identifier)
	if (!variable) return false
	return variable.defs.some(
		def =>
			def.type === 'Variable' &&
			def.node.type === 'VariableDeclarator' &&
			isIndexedAccess(def.node.init),
	)
}

const narrowsIndexedAccess = (sourceCode, node) =>
	isIndexedAccess(node) ||
	(node.type === 'Identifier' && isIndexedBinding(sourceCode, node))

export const noUndefinedComparison = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow `=== undefined` / `!== undefined`; use a truthy check `!x` / `x`. Exempt when narrowing an indexed access.',
		},
		messages: {
			undefinedComparison:
				'Compare with a truthy check instead: `!x` for `x === undefined`, `x` for `x !== undefined`.',
		},
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode ?? context.getSourceCode()
		return {
			BinaryExpression(node) {
				if (node.operator !== '===' && node.operator !== '!==') {
					return
				}
				if (!isUndefined(node.left) && !isUndefined(node.right)) {
					return
				}
				const comparand = isUndefined(node.left)
					? node.right
					: node.left
				if (narrowsIndexedAccess(sourceCode, comparand)) return

				context.report({
					node,
					messageId: 'undefinedComparison',
				})
			},
		}
	},
}
