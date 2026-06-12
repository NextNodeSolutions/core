/**
 * More than 5 destructured props on a component means split it or use
 * composition (react skill RULE 5).
 *
 * Only PascalCase functions are checked: a camelCase function taking a big
 * destructured options object is the RECOMMENDED remedy to boolean params,
 * not a smell.
 */
const MAX_PROPS = 5

const isComponentName = name => /^[A-Z]/.test(name)

const checkComponent = (context, name, fn) => {
	if (!name || !isComponentName(name)) {
		return
	}

	const [propsParam] = fn.params
	if (!propsParam || propsParam.type !== 'ObjectPattern') {
		return
	}

	const propCount = propsParam.properties.filter(
		property => property.type === 'Property',
	).length
	if (propCount <= MAX_PROPS) {
		return
	}

	context.report({
		node: propsParam,
		messageId: 'tooManyProps',
		data: { count: String(propCount), max: String(MAX_PROPS) },
	})
}

const isFunctionInit = init =>
	init?.type === 'ArrowFunctionExpression' ||
	init?.type === 'FunctionExpression'

export const maxProps = {
	meta: {
		type: 'suggestion',
		docs: {
			description: `Components must not take more than ${MAX_PROPS} props - split or compose`,
		},
		messages: {
			tooManyProps:
				'{{count}} props (max {{max}}): this component does too much. Split it, group related props, or pass children/render slots instead.',
		},
		schema: [],
	},
	create(context) {
		return {
			FunctionDeclaration(node) {
				checkComponent(context, node.id?.name, node)
			},
			VariableDeclarator(node) {
				if (node.id.type !== 'Identifier') {
					return
				}
				if (!isFunctionInit(node.init)) {
					return
				}

				checkComponent(context, node.id.name, node.init)
			},
		}
	},
}
