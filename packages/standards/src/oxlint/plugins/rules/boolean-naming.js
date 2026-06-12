/**
 * Booleans must read as yes/no questions (coding RULE 4):
 * `isActive`, `hasPermission`, `canRetry`, `shouldNotify` - never `active`,
 * `flag`, `status`. Negated forms (`isNotReady`, `hasNoAccess`) are forbidden:
 * use the positive form and negate at the call site.
 *
 * Detection is purely syntactic: boolean literal initializers and explicit
 * `: boolean` annotations on variables and parameters.
 */
const QUESTION_PREFIX =
	/^_?(is|has|had|can|could|should|was|will|did|does|do|needs|allows|supports|includes)([A-Z0-9_]|$)/
const NEGATED_PREFIX =
	/^_?(is|has|had|can|could|should|was|will|did|does|do|needs|allows|supports|includes)(Not|No)[A-Z0-9_]/

const checkName = (context, node, name) => {
	if (NEGATED_PREFIX.test(name)) {
		context.report({ node, messageId: 'negatedBoolean', data: { name } })
		return
	}
	if (!QUESTION_PREFIX.test(name)) {
		context.report({ node, messageId: 'badBooleanName', data: { name } })
	}
}

const hasBooleanAnnotation = node =>
	node.typeAnnotation?.typeAnnotation?.type === 'TSBooleanKeyword'

const checkParam = (context, param) => {
	let target = param
	let hasBooleanDefault = false

	if (target.type === 'AssignmentPattern') {
		hasBooleanDefault = typeof target.right?.value === 'boolean'
		target = target.left
	}

	if (target.type !== 'Identifier') {
		return
	}
	if (!hasBooleanAnnotation(target) && !hasBooleanDefault) {
		return
	}

	checkName(context, target, target.name)
}

const checkFunctionParams = context => node => {
	for (const param of node.params) {
		checkParam(context, param)
	}
}

export const booleanNaming = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Boolean names must read as yes/no questions (is/has/can/should...), positive form only',
		},
		messages: {
			badBooleanName:
				"Boolean '{{name}}' must read as a yes/no question: prefix it with is/has/can/should/was/will/did (e.g. isActive, hasAccess).",
			negatedBoolean:
				"Negated boolean '{{name}}' is forbidden. Use the positive form and negate at the call site (!isReady instead of isNotReady).",
		},
		schema: [],
	},
	create(context) {
		const checkParams = checkFunctionParams(context)
		return {
			VariableDeclarator(node) {
				if (node.id.type !== 'Identifier') {
					return
				}

				const isBooleanLiteral = typeof node.init?.value === 'boolean'
				if (!isBooleanLiteral && !hasBooleanAnnotation(node.id)) {
					return
				}

				checkName(context, node.id, node.id.name)
			},
			FunctionDeclaration: checkParams,
			FunctionExpression: checkParams,
			ArrowFunctionExpression: checkParams,
		}
	},
}
