/**
 * A component file is named after its primary export (coding RULE 13):
 * `UserCard.tsx` exports `UserCard`.
 *
 * Scope is deliberately narrow: only PascalCase-named files containing
 * exactly one exported PascalCase component are checked. The export can be
 * named (`export function UserCard` / `export const UserCard` /
 * `export { UserCard }`) or default (`export default function UserCard` /
 * `export default UserCard`). Index files are composition roots and exempt;
 * re-exports from another module (`export { X } from './y'`) are barrels and
 * out of scope.
 */
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/

const baseSegment = filename => {
	const base = filename.split(/[\\/]/).pop() ?? ''
	return base.split('.')[0] ?? ''
}

const isPascalIdentifier = node =>
	node?.type === 'Identifier' && PASCAL_CASE.test(node.name)

const collectDeclarationName = (declaration, exported) => {
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
		if (isPascalIdentifier(declarator.id)) {
			exported.push(declarator.id)
		}
	}
}

const collectNamedExport = (node, exported) => {
	if (node.declaration) {
		collectDeclarationName(node.declaration, exported)
		return
	}
	// `export { Drawer }` shorthand: the specifier's exported name is the
	// file's primary export. A `from` clause makes it a re-export barrel,
	// which the rule deliberately ignores.
	if (node.source) {
		return
	}
	for (const specifier of node.specifiers) {
		if (isPascalIdentifier(specifier.exported)) {
			exported.push(specifier.exported)
		}
	}
}

const collectDefaultExport = (node, exported) => {
	const { declaration } = node
	// `export default function Gizmo` / `export default class Gizmo`.
	if (
		(declaration.type === 'FunctionDeclaration' ||
			declaration.type === 'ClassDeclaration') &&
		declaration.id &&
		PASCAL_CASE.test(declaration.id.name)
	) {
		exported.push(declaration.id)
		return
	}
	// `export default Gizmo` referencing a component declared above.
	if (isPascalIdentifier(declaration)) {
		exported.push(declaration)
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
				collectNamedExport(node, exported)
			},
			ExportDefaultDeclaration(node) {
				collectDefaultExport(node, exported)
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
