/**
 * Forbid Tailwind class lists stored in a variable, constant, object or array.
 * Tailwind classes are only legible and testable at their point of use: inline
 * in a `className`/`class` attribute, or fed through a class-authoring call
 * (cva, tv, cn, clsx, cx, twMerge). Detached in a `const`, they escape the
 * variant contract CVA gives and lose their JSX context.
 *
 * Detection is heuristic: a string is treated as Tailwind when at least two of
 * its whitespace-separated tokens look like Tailwind utilities and they form a
 * majority of the tokens. Restricting to known utility prefixes keeps prose
 * ('save user-profile now') from matching.
 */
const MIN_MATCHED_TOKENS = 2
const MIN_MATCHED_RATIO = 0.5

// One token per entry, never a space-joined list: a class-list string literal
// would trip this very rule.
const STANDALONE = new Set([
	'flex',
	'grid',
	'block',
	'inline',
	'hidden',
	'contents',
	'table',
	'relative',
	'absolute',
	'fixed',
	'sticky',
	'static',
	'isolate',
	'italic',
	'underline',
	'overline',
	'uppercase',
	'lowercase',
	'capitalize',
	'truncate',
	'rounded',
	'border',
	'container',
	'shadow',
	'ring',
	'blur',
	'grayscale',
	'invert',
	'transform',
	'antialiased',
	'group',
	'peer',
	'visible',
	'invisible',
	'collapse',
])

const PREFIXES = new Set(
	'p px py pt pb pl pr ps pe m mx my mt mb ml mr ms me space gap w h size min max text font leading tracking indent align whitespace break list decoration underline bg from via to fill stroke accent caret border rounded ring outline shadow opacity divide z top right bottom left inset order col row grid flex basis grow shrink columns justify items content self place object aspect overflow cursor select resize scroll snap touch will transition duration delay ease animate scale rotate translate skew origin backdrop brightness contrast saturate sepia float clear box'.split(
		' ',
	),
)

const VARIANTS = new Set(
	'sm md lg xl 2xl 2xs 3xl 4xl 5xl 6xl 7xl hover focus focus-within focus-visible active visited target first last only odd even disabled enabled checked indeterminate default required valid invalid placeholder-shown autofill read-only dark motion-safe motion-reduce print portrait landscape rtl ltr group-hover group-focus peer-hover peer-focus peer-checked before after placeholder selection marker file first-line first-letter backdrop open empty'.split(
		' ',
	),
)

const NAMESPACED_VARIANT = /^(data|aria|group|peer|has|supports|nth)-/

const isKnownVariant = segment =>
	VARIANTS.has(segment) ||
	segment.includes('[') ||
	NAMESPACED_VARIANT.test(segment)

const stripDecorations = utility => {
	let core = utility
	if (core.startsWith('!')) core = core.slice(1)
	if (core.startsWith('-')) core = core.slice(1)
	return core.replace(/\/[^/]+$/, '')
}

const isUtilityCore = core => {
	if (!core.length) return false
	if (core.includes('[')) return true
	if (STANDALONE.has(core)) return true
	if (!core.includes('-')) return false
	return PREFIXES.has(core.slice(0, core.indexOf('-')))
}

const isTailwindToken = token => {
	if (!token.length) return false

	const segments = token.split(':')
	const variants = segments.slice(0, -1)
	if (!variants.every(isKnownVariant)) return false

	const core = stripDecorations(segments[segments.length - 1])
	if (isUtilityCore(core)) return true
	return variants.length > 0
}

const looksLikeTailwind = classString => {
	const tokens = classString.split(/\s+/).filter(Boolean)
	if (tokens.length < MIN_MATCHED_TOKENS) return false

	const matched = tokens.filter(isTailwindToken).length
	return (
		matched >= MIN_MATCHED_TOKENS &&
		matched / tokens.length >= MIN_MATCHED_RATIO
	)
}

const ALLOWED_CALLS = new Set(
	'cva tv cn cx clsx twMerge twJoin classnames classNames'.split(' '),
)

const calleeName = callee => {
	if (callee.type === 'Identifier') return callee.name
	if (
		callee.type === 'MemberExpression' &&
		callee.property.type === 'Identifier'
	) {
		return callee.property.name
	}
	return undefined
}

const jsxAttrName = attribute => {
	const { name } = attribute
	if (name.type === 'JSXNamespacedName') {
		return `${name.namespace.name}:${name.name.name}`
	}
	return name.name
}

const isClassAttribute = attribute => {
	const name = jsxAttrName(attribute)
	return name === 'className' || name === 'class' || name.startsWith('class:')
}

const isAllowedAncestor = ancestor => {
	if (ancestor.type === 'JSXAttribute') return isClassAttribute(ancestor)
	if (ancestor.type === 'CallExpression') {
		return ALLOWED_CALLS.has(calleeName(ancestor.callee))
	}
	return false
}

const isInAllowedContext = node => {
	let ancestor = node.parent
	while (ancestor) {
		if (isAllowedAncestor(ancestor)) return true
		ancestor = ancestor.parent
	}
	return false
}

const templateValue = node =>
	node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).join(' ')

export const noDetachedTailwind = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow Tailwind class lists stored in a variable, constant, object or array; keep them inline in className/class or in a cva/tv/cn/clsx/cx/twMerge call',
		},
		messages: {
			detachedTailwind:
				'Tailwind classes belong inline in a className/class attribute or in a cva/tv/cn/clsx/cx/twMerge call, not detached in a variable. Move them to the JSX or express the variants with cva.',
		},
		schema: [],
	},
	create(context) {
		const check = node => classString => {
			if (!looksLikeTailwind(classString)) return
			if (isInAllowedContext(node)) return
			context.report({ node, messageId: 'detachedTailwind' })
		}

		return {
			Literal(node) {
				if (typeof node.value === 'string') check(node)(node.value)
			},
			TemplateLiteral(node) {
				check(node)(templateValue(node))
			},
		}
	},
}
