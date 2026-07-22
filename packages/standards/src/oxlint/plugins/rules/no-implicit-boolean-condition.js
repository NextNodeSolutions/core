/**
 * Require conditions to be explicit booleans. A bare value in a condition
 * (`document.assets ? a : b`, `if (list)`) leans on truthiness coercion, so an
 * `undefined`, `0`, `''` or `NaN` silently takes the false branch. State the
 * test with a comparison (`document.assets != null`, `list.length > 0`) so the
 * boundary is intentional. `!!value` is not the fix here: `no-extra-boolean-cast`
 * rejects it in a condition.
 *
 * Scope: the test of a ternary and `if`/`while`/`do-while`. Purely syntactic,
 * so a condition is accepted when it already reads as a boolean: `!x`, a
 * comparison (`===`, `<`, `in`, `instanceof`...), a `&&`/`||` chain, a
 * `true`/`false` literal, or an identifier/member whose name reads as a yes/no
 * question (is/has/can/should...), matching `boolean-naming`. A call is opaque
 * to the AST (`set.has(x)`, `regex.test(s)` return real booleans), so any call
 * is accepted too; the target is a bare value access like `document.assets`.
 */
const BOOLEAN_BINARY_OPERATORS = new Set([
	'===',
	'!==',
	'==',
	'!=',
	'<',
	'>',
	'<=',
	'>=',
	'in',
	'instanceof',
])

const QUESTION_PREFIX =
	/^_?(is|has|had|can|could|should|was|will|did|does|do|needs|allows|supports|includes)([A-Z0-9_]|$)/

const conditionName = node => {
	if (node.type === 'Identifier') {
		return node.name
	}
	if (
		node.type === 'MemberExpression' &&
		!node.computed &&
		node.property.type === 'Identifier'
	) {
		return node.property.name
	}
	return ''
}

const isBooleanCondition = node => {
	switch (node.type) {
		case 'ChainExpression':
			return isBooleanCondition(node.expression)
		case 'UnaryExpression':
			return node.operator === '!'
		case 'BinaryExpression':
			return BOOLEAN_BINARY_OPERATORS.has(node.operator)
		case 'LogicalExpression':
			return true
		case 'Literal':
			return typeof node.value === 'boolean'
		case 'CallExpression':
			return true
		case 'Identifier':
		case 'MemberExpression':
			return QUESTION_PREFIX.test(conditionName(node))
		default:
			return false
	}
}

export const noImplicitBooleanCondition = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Require conditions (ternary test, if/while) to be explicit booleans; compare coerced values instead of relying on truthiness',
		},
		messages: {
			implicitBooleanCondition:
				'A non-boolean value used as a condition relies on implicit truthiness (`undefined`/`0`/`""`/`NaN` silently take the false branch). Compare it explicitly instead (`value != null`, `value.length > 0`).',
		},
		schema: [],
	},
	create(context) {
		const check = node => {
			if (!isBooleanCondition(node.test)) {
				context.report({
					node: node.test,
					messageId: 'implicitBooleanCondition',
				})
			}
		}
		return {
			ConditionalExpression: check,
			IfStatement: check,
			WhileStatement: check,
			DoWhileStatement: check,
		}
	},
}
