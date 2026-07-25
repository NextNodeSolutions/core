/**
 * Forbid a single-use `const` that only re-reads a property under the same
 * name: `const error = obj.error` or `const error = obj ? obj.error : null`,
 * each used exactly once. The binding adds no name the access did not already
 * carry (`error` <- `.error`), so inline it: `obj.error`, `obj?.error` for the
 * guarded form. A binding earns its keep when it is read more than once (DRY),
 * when its initializer is impure or computed (a call, arithmetic, a named
 * boolean), or when it renames the property (`const user = obj.currentUser`) -
 * none of those fire here. Object destructuring is exempt whatever its arity:
 * `const { active } = Astro.props` states the shape a module consumes, which
 * the inlined access does not.
 */
const isNullish = node =>
	(node.type === 'Literal' && node.value === null) ||
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void')

const isSimpleRef = node => {
	if (node.type === 'Identifier' || node.type === 'ThisExpression') {
		return true
	}
	return (
		node.type === 'MemberExpression' &&
		!node.computed &&
		isSimpleRef(node.object)
	)
}

const memberLeaf = node => {
	if (
		node.type !== 'MemberExpression' ||
		node.computed ||
		!isSimpleRef(node.object)
	) {
		return null
	}
	return node.property.name
}

const guardedMemberLeaf = node => {
	if (node.type !== 'ConditionalExpression') return null
	if (!isNullish(node.alternate)) return null
	if (
		node.test.type !== 'Identifier' ||
		node.consequent.type !== 'MemberExpression' ||
		node.consequent.computed ||
		node.consequent.object.type !== 'Identifier' ||
		node.consequent.object.name !== node.test.name
	) {
		return null
	}
	return node.consequent.property.name
}

const redundantAlias = node => {
	if (node.id.type !== 'Identifier' || !node.init) return null
	const leaf = memberLeaf(node.init) ?? guardedMemberLeaf(node.init)
	if (leaf !== node.id.name) return null
	return leaf
}

const isExportRead = reference =>
	reference.identifier.parent?.type === 'ExportSpecifier'

export const noSingleUsePassthrough = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow a single-use const that only re-reads a property under the same name; inline the access instead',
		},
		messages: {
			passthrough:
				"'{{name}}' is read once and only re-reads `.{{name}}` - the binding adds no name the access did not carry. Inline it: `obj.{{name}}`, or `obj?.{{name}}` for the guarded form.",
		},
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode ?? context.getSourceCode()
		return {
			VariableDeclarator(node) {
				if (
					node.parent.type !== 'VariableDeclaration' ||
					node.parent.kind !== 'const' ||
					node.parent.declarations.length !== 1
				) {
					return
				}

				const leaf = redundantAlias(node)
				if (leaf === null) return

				const [variable] = sourceCode.getDeclaredVariables(node)
				if (!variable) return

				const reads = variable.references.filter(
					reference => reference.isRead() && !isExportRead(reference),
				)
				if (reads.length !== 1) return

				context.report({
					node: node.id,
					messageId: 'passthrough',
					data: { name: leaf },
				})
			},
		}
	},
}
