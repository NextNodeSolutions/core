/**
 * Forbid barrel modules: a file that re-exports another module's bindings
 * (`export … from`, `export * from`, `export * as ns from`) instead of owning
 * them. Barrels hide the real definition site, create import cycles and defeat
 * tree-shaking; consumers must import from the defining module directly.
 *
 * A published package entry point is the one legitimate barrel: opt it out with
 * `/* eslint-disable nextnode/no-barrel-file -- package public entry *\/`.
 */
export const noBarrelFile = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow barrel modules (`export … from`); import from the defining module instead',
		},
		messages: {
			namedReexport:
				"Barrel re-export of '{{source}}' is forbidden. Import from the defining module directly, or move the binding into this file.",
			starReexport:
				"Star re-export of '{{source}}' is forbidden. Import from the defining module directly.",
		},
		schema: [],
	},
	create(context) {
		const report = (node, messageId) => {
			context.report({
				node,
				messageId,
				data: { source: node.source.value },
			})
		}

		return {
			ExportNamedDeclaration(node) {
				if (!node.source) return
				report(node, 'namedReexport')
			},
			ExportAllDeclaration(node) {
				report(node, 'starReexport')
			},
		}
	},
}
