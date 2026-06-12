/**
 * Forbid meaningless generic identifiers (coding RULE 4): data, info, result,
 * item, value, temp, stuff. If everything is `data`, nothing is.
 *
 * Only declarations we own are checked (variables, parameters, function
 * names). Property access and property keys are exempt - external shapes are
 * not ours to rename.
 */
const BANNED_NAMES = new Set([
	'data',
	'info',
	'result',
	'item',
	'value',
	'temp',
	'stuff',
])

const checkIdentifier = (context, node, name) => {
	if (!BANNED_NAMES.has(name)) {
		return
	}

	context.report({ node, messageId: 'genericName', data: { name } })
}

const unwrapParam = param => {
	if (param.type === 'AssignmentPattern') {
		return param.left
	}
	if (param.type === 'RestElement') {
		return param.argument
	}
	return param
}

const checkFunctionNames = context => node => {
	if (node.id?.type === 'Identifier') {
		checkIdentifier(context, node.id, node.id.name)
	}
	for (const param of node.params) {
		const target = unwrapParam(param)
		if (target.type === 'Identifier') {
			checkIdentifier(context, target, target.name)
		}
	}
}

export const noGenericNames = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow generic identifiers (data, info, result, item, value, temp, stuff) for owned declarations',
		},
		messages: {
			genericName:
				"'{{name}}' says nothing about what it holds. Name it after the domain: activeUsers, retryDelayMs, parsedConfig...",
		},
		schema: [],
	},
	create(context) {
		const checkFunctions = checkFunctionNames(context)
		return {
			VariableDeclarator(node) {
				if (node.id.type === 'Identifier') {
					checkIdentifier(context, node.id, node.id.name)
				}
			},
			FunctionDeclaration: checkFunctions,
			FunctionExpression: checkFunctions,
			ArrowFunctionExpression: checkFunctions,
		}
	},
}
