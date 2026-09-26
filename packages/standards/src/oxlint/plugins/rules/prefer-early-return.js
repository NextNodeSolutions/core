/**
 * Prefer the smaller return first as the early guard. When a block ends with
 *   if (cond) return A;
 *   return B;
 * and the trailing return B is not larger than A, flip to
 *   if (!cond) return B;
 *   return A;
 * The branch choice is primary; the negated condition only breaks ties - a
 * negative guard kept on a tie already has the preferred shape. Auto-fixable.
 */
const PREFIX_SAFE_TYPES = new Set([
	'Identifier',
	'MemberExpression',
	'CallExpression',
])
const MIN_STATEMENTS = 2
const LAST_TWO = -2

const returnSize = (source, { argument }) => {
	if (!argument) return 0
	const text = source.getText(argument).replace(/\s+/g, '')
	// A valueless return and `undefined`/`null` are the simplest returns.
	if (text === 'undefined' || text === 'null') return 0
	return text.length
}

// Invert the test: strip a top-level `!` when flipping a negative guard,
// otherwise prefix `!` where it cannot bind to an operator on the left edge
// (wrap everything else so `a && b` stays `!(a && b)`).
const invert = (source, test) => {
	if (test.type === 'UnaryExpression' && test.operator === '!')
		return source.getText(test.argument)
	const text = source.getText(test)
	return PREFIX_SAFE_TYPES.has(test.type) ? `!${text}` : `!(${text})`
}

const flipCandidate = (source, statements) => {
	if (statements.length < MIN_STATEMENTS) return undefined
	const [guard, tail] = statements.slice(LAST_TWO)
	if (
		tail.type !== 'ReturnStatement' ||
		guard.type !== 'IfStatement' ||
		guard.alternate
	)
		return undefined

	let guarded = guard.consequent
	if (guarded.type === 'BlockStatement') {
		if (guarded.body.length !== 1) return undefined
		guarded = guarded.body[0]
	}
	if (guarded.type !== 'ReturnStatement') return undefined

	const earlySize = returnSize(source, guarded)
	const tailSize = returnSize(source, tail)
	// Branch first: the smaller return guards. Negation only breaks ties.
	const isFlipUnnecessary =
		tailSize > earlySize || (earlySize === 0 && tailSize === 0)
	if (isFlipUnnecessary) return undefined
	const tiedAndNegative =
		tailSize === earlySize &&
		guard.test.type === 'UnaryExpression' &&
		guard.test.operator === '!'
	if (tiedAndNegative) return undefined
	return { guard, guarded, tail }
}

export const preferEarlyReturn = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Smaller return first as the early guard; negated condition on ties',
		},
		fixable: 'code',
		messages: {
			flip: 'Put the smaller return first as the early guard; prefer the negated condition on ties: `if (!<cond>) return <smaller>; return <larger>`.',
		},
		schema: [],
	},
	create(context) {
		const source = context.sourceCode
		return {
			BlockStatement(block) {
				const flip = flipCandidate(source, block.body)
				if (!flip) return
				const { guard, guarded, tail } = flip
				context.report({
					node: guard,
					messageId: 'flip',
					fix: fixer => [
						fixer.replaceText(
							guard.test,
							invert(source, guard.test),
						),
						fixer.replaceText(
							tail,
							`return ${source.getText(guarded.argument)}`,
						),
						fixer.replaceText(
							guarded,
							`return ${source.getText(tail.argument)}`,
						),
					],
				})
			},
		}
	},
}
