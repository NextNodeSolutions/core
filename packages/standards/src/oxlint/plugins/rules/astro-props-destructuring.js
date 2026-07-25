/**
 * Force Astro props to be read through destructuring: `const { active } =
 * Astro.props`, never `Astro.props.active`. The destructuring at the top of the
 * frontmatter is the component's props contract - one place to read what the
 * component consumes; scattered `Astro.props.x` accesses hide it.
 *
 * Only member access fires. Passing the object along (`{...Astro.props}`,
 * `render(Astro.props)`) keeps the whole shape and is exempt.
 */
const isAstroProps = node =>
	node?.type === 'MemberExpression' &&
	node.computed === false &&
	node.object.type === 'Identifier' &&
	node.object.name === 'Astro' &&
	node.property.type === 'Identifier' &&
	node.property.name === 'props'

export const astroPropsDestructuring = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Require reading Astro props through destructuring (`const { x } = Astro.props`) instead of member access (`Astro.props.x`)',
		},
		messages: {
			memberAccess:
				'Read props through a destructuring instead: `const { {{name}} } = Astro.props`, then use `{{name}}`. The destructuring is the component props contract.',
		},
		schema: [],
	},
	create(context) {
		return {
			MemberExpression(node) {
				if (!isAstroProps(node.object)) return

				context.report({
					node,
					messageId: 'memberAccess',
					data: {
						name:
							node.computed || node.property.type !== 'Identifier'
								? 'prop'
								: node.property.name,
					},
				})
			},
		}
	},
}
