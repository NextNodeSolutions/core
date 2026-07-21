/**
 * Force the empty/absent branch of a ternary to be the alternate, never the
 * consequent. A sentinel consequent (`cond ? null : x`, `cond ? undefined : x`,
 * `cond ? {} : x`) reads backwards: the positive branch should carry the value
 * and the fallback the sentinel. Write `cond ? value : sentinel`, or extract an
 * early-return helper returning `T | undefined` and spread it.
 */
const isSentinel = node =>
	(node.type === 'Literal' && node.value === null) ||
	(node.type === 'Identifier' && node.name === 'undefined') ||
	(node.type === 'UnaryExpression' && node.operator === 'void') ||
	(node.type === 'ObjectExpression' && node.properties.length === 0)

export const noSentinelConsequent = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow a null/undefined/empty-object consequent in a ternary; the sentinel must be the alternate',
		},
		messages: {
			sentinelConsequent:
				'The empty/absent branch must be the alternate, not the consequent. Write `cond ? value : sentinel`, or extract an early-return helper returning `T | undefined` and spread it.',
		},
		schema: [],
	},
	create(context) {
		return {
			ConditionalExpression(node) {
				if (isSentinel(node.consequent)) {
					context.report({
						node,
						messageId: 'sentinelConsequent',
					})
				}
			},
		}
	},
}
