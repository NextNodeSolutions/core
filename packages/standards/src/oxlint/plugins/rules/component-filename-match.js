/**
 * A component file is named after its primary export (coding RULE 13):
 * `UserCard.tsx` exports `UserCard`.
 *
 * Scope is deliberately narrow: only PascalCase-named files containing
 * exactly one exported PascalCase declaration are checked. Index files are
 * composition roots and exempt.
 */
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/

const baseSegment = filename => {
	const base = filename.split(/[\\/]/).pop() ?? ''
	return base.split('.')[0] ?? ''
}

const collectExportedNames = (node, exported) => {
	const { declaration } = node
	if (!declaration) {
		return
	}

	if (
		declaration.type === 'FunctionDeclaration' &&
		declaration.id &&
		PASCAL_CASE.test(declaration.id.name)
	) {
		exported.push(declaration.id)
		return
	}

	if (declaration.type !== 'VariableDeclaration') {
		return
	}
	for (const declarator of declaration.declarations) {
		if (
			declarator.id.type === 'Identifier' &&
			PASCAL_CASE.test(declarator.id.name)
		) {
			exported.push(declarator.id)
		}
	}
}

export const componentFilenameMatch = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'A PascalCase file must be named after the single component it exports',
		},
		messages: {
			filenameMismatch:
				"File is named '{{base}}' but exports '{{name}}'. Rename one of them: the file is named after its primary export (UserCard.tsx exports UserCard).",
		},
		schema: [],
	},
	create(context) {
		const base = baseSegment(context.filename)
		if (!PASCAL_CASE.test(base)) {
			return {}
		}

		const exported = []
		let hasReported = false
		return {
			ExportNamedDeclaration(node) {
				collectExportedNames(node, exported)
			},
			'Program:exit'() {
				if (hasReported || exported.length !== 1) {
					return
				}

				const [onlyExport] = exported
				if (onlyExport.name === base) {
					return
				}

				hasReported = true
				context.report({
					node: onlyExport,
					messageId: 'filenameMismatch',
					data: { name: onlyExport.name, base },
				})
			},
		}
	},
}
