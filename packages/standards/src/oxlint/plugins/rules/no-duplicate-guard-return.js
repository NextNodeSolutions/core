// Adjacent guards returning the same expression can share a condition.
// Only compare source-identical returns: different expressions may have
// different effects, even when they look like the same fallback.
const returnedText = (statement, source) => {
	if (statement.type !== 'IfStatement' || statement.alternate) return null
	const { consequent } = statement
	const guarded =
		consequent.type === 'BlockStatement'
			? consequent.body.length === 1 && consequent.body[0]
			: consequent
	if (!guarded || guarded.type !== 'ReturnStatement') return null
	return guarded.argument ? source.getText(guarded.argument) : ''
}

export const noDuplicateGuardReturn = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Combine adjacent guards that return the same expression into one condition',
		},
		messages: {
			combine:
				'Adjacent guards return the same expression. Combine their conditions with `||`, or name the shared condition if it expresses one rule.',
		},
		schema: [],
	},
	create(context) {
		const source = context.sourceCode
		return {
			BlockStatement(block) {
				let previousReturn
				let hasReported = false
				for (const statement of block.body) {
					const currentReturn = returnedText(statement, source)
					const isDuplicate =
						currentReturn !== null &&
						currentReturn === previousReturn
					if (isDuplicate && !hasReported) {
						context.report({
							node: statement,
							messageId: 'combine',
						})
					}
					hasReported = isDuplicate
					previousReturn = currentReturn
				}
			},
		}
	},
}
