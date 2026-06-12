/**
 * No utils.ts / helpers.ts grab-bags of unrelated helpers (coding RULE 13).
 * Name the module after its single concern: tax.ts, formatDate.ts,
 * date-utils.ts. Bare generic basenames are forbidden.
 */
const GRAB_BAG_NAMES = new Set(['utils', 'helpers', 'helper', 'misc', 'common'])

const baseSegment = filename => {
	const base = filename.split(/[\\/]/).pop() ?? ''
	return (base.split('.')[0] ?? '').toLowerCase()
}

export const noGrabBagFiles = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow grab-bag module names (utils, helpers, misc, common)',
		},
		messages: {
			grabBagFile:
				"'{{base}}' is a grab-bag name. Name the module after its single concern (tax.ts, date-utils.ts) and split unrelated helpers.",
		},
		schema: [],
	},
	create(context) {
		const base = baseSegment(context.filename)
		if (!GRAB_BAG_NAMES.has(base)) {
			return {}
		}

		return {
			Program(node) {
				context.report({
					node,
					messageId: 'grabBagFile',
					data: { base },
				})
			},
		}
	},
}
