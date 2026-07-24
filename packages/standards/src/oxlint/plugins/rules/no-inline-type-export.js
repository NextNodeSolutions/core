/**
 * Forbid inline `type` specifiers in export statements: `export { X, type Y }`
 * must be split into `export { X }` plus `export type { Y }`. Mirrors
 * `import/consistent-type-specifier-style` (prefer-top-level), whose oxlint
 * implementation only covers import statements.
 */
export const noInlineTypeExport = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow inline `type` specifiers in export statements; group them in a top-level `export type { … }`',
		},
		messages: {
			inlineTypeExport:
				'Inline `type {{name}}` specifier. Move it to a top-level `export type { {{name}} }` statement.',
		},
		schema: [],
	},
	create(context) {
		return {
			ExportNamedDeclaration(node) {
				if (node.exportKind === 'type') return

				for (const specifier of node.specifiers) {
					if (specifier.exportKind !== 'type') continue

					context.report({
						node: specifier,
						messageId: 'inlineTypeExport',
						data: { name: specifier.local.name },
					})
				}
			},
		}
	},
}
