/**
 * Flag every `useEffect` call (react skill RULE 1: "you do not need
 * useEffect, most of the time").
 *
 * Warning-level by design: effects ARE correct for synchronizing with
 * external systems (WebSocket, ResizeObserver, non-React widgets). The
 * warning forces the question "why does this code run?" - user interaction
 * → event handler; derived value → compute during render.
 *
 * When the effect is a genuine external-sync (with cleanup), silence the
 * nag on that line rather than reaching for a heavier primitive:
 *   // oxlint-disable-next-line nextnode/no-use-effect
 */
const isUseEffectCallee = callee => {
	if (callee.type === 'Identifier') {
		return callee.name === 'useEffect'
	}
	return (
		callee.type === 'MemberExpression' &&
		!callee.computed &&
		callee.property.type === 'Identifier' &&
		callee.property.name === 'useEffect'
	)
}

export const noUseEffect = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Flag useEffect calls - most are avoidable (event handler or derived value)',
		},
		messages: {
			noUseEffect:
				'Do you really need useEffect? User interaction → event handler; derived value → compute during render. Effects are only for syncing with external systems (and need a cleanup).',
		},
		schema: [],
	},
	create(context) {
		return {
			CallExpression(node) {
				if (!isUseEffectCallee(node.callee)) {
					return
				}

				context.report({
					node,
					messageId: 'noUseEffect',
				})
			},
		}
	},
}
