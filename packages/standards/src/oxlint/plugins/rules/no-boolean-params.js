/**
 * Forbid two or more boolean parameters on a function (coding RULE 6).
 *
 * Boolean parameters make call sites unreadable: `format(now, true, false)`.
 * One boolean on a helper is tolerated; two or more never are - use an
 * options object or split the function.
 */
const isBooleanParam = param => {
	let target = param

	if (target.type === 'AssignmentPattern') {
		if (typeof target.right?.value === 'boolean') {
			return true
		}
		target = target.left
	}

	return target.typeAnnotation?.typeAnnotation?.type === 'TSBooleanKeyword'
}

const MAX_TOLERATED_BOOLEANS = 1

const checkFunction = (context, node) => {
	const booleanParams = node.params.filter(isBooleanParam)
	if (booleanParams.length <= MAX_TOLERATED_BOOLEANS) {
		return
	}

	context.report({
		node: booleanParams[MAX_TOLERATED_BOOLEANS],
		messageId: 'tooManyBooleans',
		data: { count: String(booleanParams.length) },
	})
}

export const noBooleanParams = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow functions taking two or more boolean parameters',
		},
		messages: {
			tooManyBooleans:
				'{{count}} boolean parameters make call sites unreadable. Use an options object ({ utc: true }) or split into separate functions.',
		},
		schema: [],
	},
	create(context) {
		return {
			FunctionDeclaration(node) {
				checkFunction(context, node)
			},
			FunctionExpression(node) {
				checkFunction(context, node)
			},
			ArrowFunctionExpression(node) {
				checkFunction(context, node)
			},
		}
	},
}
