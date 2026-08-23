/**
 * Forbid locally declared generic representation guards.
 *
 * Unknown values should be validated with the application's schema library at
 * an I/O boundary. Rare package-wide low-level guards may use a documented,
 * targeted `oxlint-disable-next-line` comment.
 */
const COMMON_GENERIC_GUARD_NAMES = new Set([
	'isString',
	'isNumber',
	'isBoolean',
	'isBigInt',
	'isSymbol',
	'isObject',
	'isRecord',
	'isArray',
	'isPlainObject',
	'isUnknownRecord',
	'isStringRecord',
])

const GENERIC_PRIMITIVE_TYPES = new Set([
	'TSStringKeyword',
	'TSNumberKeyword',
	'TSBooleanKeyword',
	'TSBigIntKeyword',
	'TSSymbolKeyword',
	'TSObjectKeyword',
])

const GENERIC_CONTAINER_TYPES = new Set([
	'Record',
	'ReadonlyRecord',
	'Array',
	'ReadonlyArray',
])

const isIdentifier = node => node?.type === 'Identifier'

const typeAnnotationOf = node => {
	let annotation = node?.typeAnnotation
	while (annotation?.type === 'TSTypeAnnotation') {
		annotation = annotation.typeAnnotation
	}
	return annotation
}

const isUnknownParameter = parameter => {
	const parameterNode =
		parameter?.type === 'AssignmentPattern' ? parameter.left : parameter
	const annotation = typeAnnotationOf(parameterNode)
	return (
		annotation?.type === 'TSUnknownKeyword' ||
		annotation?.type === 'TSAnyKeyword'
	)
}

const isGenericRepresentationType = type => {
	if (!type) return false
	if (GENERIC_PRIMITIVE_TYPES.has(type.type)) return true
	if (type.type === 'TSUnknownKeyword' || type.type === 'TSAnyKeyword') {
		return true
	}
	if (type.type === 'TSArrayType') {
		return isGenericRepresentationType(type.elementType)
	}
	if (type.type !== 'TSTypeReference' || !isIdentifier(type.typeName)) {
		return false
	}
	if (!GENERIC_CONTAINER_TYPES.has(type.typeName.name)) return false
	return (type.typeArguments?.params ?? []).some(isGenericRepresentationType)
}

const predicateTarget = functionNode => {
	const predicate = typeAnnotationOf(functionNode.returnType)
	if (predicate?.type !== 'TSTypePredicate') return undefined
	return typeAnnotationOf(predicate)
}

const isGenericGuard = (functionNode, name) => {
	if (!isUnknownParameter(functionNode.params[0])) return false
	if (isGenericRepresentationType(predicateTarget(functionNode))) return true
	return Boolean(name) && COMMON_GENERIC_GUARD_NAMES.has(name)
}

const methodName = node => (isIdentifier(node.key) ? node.key.name : undefined)

const isFunctionExpression = node =>
	node?.type === 'ArrowFunctionExpression' ||
	node?.type === 'FunctionExpression'

const expressionName = (expression, fallback) =>
	expression.type === 'FunctionExpression' && expression.id
		? expression.id.name
		: fallback

const FUNCTION_EXPRESSION_PARENTS = new Set([
	'ExportDefaultDeclaration',
	'VariableDeclarator',
	'Property',
	'PropertyDefinition',
	'MethodDefinition',
])

const createReporter = context => {
	const reported = new Set()
	return node => {
		if (reported.has(node)) return
		reported.add(node)
		context.report({ node, messageId: 'noGenericRuntimeGuard' })
	}
}

const createGuardVisitors = context => {
	const report = createReporter(context)
	const reportIfGenericGuard = (functionNode, name, reportNode) => {
		if (isGenericGuard(functionNode, name)) report(reportNode)
	}
	const reportFunctionProperty = node => {
		if (!isFunctionExpression(node.value)) return
		reportIfGenericGuard(
			node.value,
			expressionName(node.value, methodName(node)),
			node.key,
		)
	}

	return {
		ExportDefaultDeclaration(node) {
			if (!isFunctionExpression(node.declaration)) return
			reportIfGenericGuard(
				node.declaration,
				node.declaration.id?.name,
				node.declaration,
			)
		},
		FunctionDeclaration(node) {
			reportIfGenericGuard(node, node.id?.name, node.id ?? node)
		},
		VariableDeclarator(node) {
			if (!isFunctionExpression(node.init)) return
			const fallback = isIdentifier(node.id) ? node.id.name : undefined
			reportIfGenericGuard(
				node.init,
				expressionName(node.init, fallback),
				node.id,
			)
		},
		FunctionExpression(node) {
			if (
				!node.id ||
				FUNCTION_EXPRESSION_PARENTS.has(node.parent?.type)
			) {
				return
			}
			reportIfGenericGuard(node, node.id.name, node.id)
		},
		Property: reportFunctionProperty,
		PropertyDefinition: reportFunctionProperty,
		MethodDefinition: reportFunctionProperty,
	}
}

export const noGenericRuntimeGuard = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow locally declared generic runtime guards; validate unknown input with a schema at its I/O boundary instead',
		},
		messages: {
			noGenericRuntimeGuard:
				'Generic runtime guards duplicate schema validation. Validate unknown input with the application schema library at its I/O boundary. A rare canonical low-level helper requires a documented, targeted oxlint-disable-next-line comment.',
		},
		schema: [],
	},
	create: createGuardVisitors,
}
