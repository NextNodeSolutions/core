/**
 * Forbid Unicode characters that render like ASCII but are not: curly and angle
 * quotes, non-em dashes, non-breaking or zero-width spaces. They survive
 * copy-paste invisibly, so a token, key or comparison built from one silently
 * stops matching its ASCII twin. The em dash has its own rule (no-em-dash).
 * Accented letters and ligatures stay allowed.
 *
 * Every entry is written as an escape on purpose: this file must itself stay
 * pure ASCII, and the space variants are indistinguishable when written raw.
 */
import { reportSourceMatches } from '../source-scan.js'

const APOSTROPHE = "`'` (U+0027)"
const QUOTE = '`"` (U+0022)'
const HYPHEN = '`-` (U+002D)'
const SPACE = 'a plain space (U+0020)'
const NOTHING = 'nothing, delete it'

const CONFUSABLES = new Map([
	['\u2018', ['U+2018 LEFT SINGLE QUOTATION MARK', APOSTROPHE]],
	['\u2019', ['U+2019 RIGHT SINGLE QUOTATION MARK', APOSTROPHE]],
	['\u201a', ['U+201A SINGLE LOW-9 QUOTATION MARK', APOSTROPHE]],
	['\u201b', ['U+201B SINGLE HIGH-REVERSED-9 QUOTATION MARK', APOSTROPHE]],
	['\u201c', ['U+201C LEFT DOUBLE QUOTATION MARK', QUOTE]],
	['\u201d', ['U+201D RIGHT DOUBLE QUOTATION MARK', QUOTE]],
	['\u201e', ['U+201E DOUBLE LOW-9 QUOTATION MARK', QUOTE]],
	['\u201f', ['U+201F DOUBLE HIGH-REVERSED-9 QUOTATION MARK', QUOTE]],
	['\u00ab', ['U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK', QUOTE]],
	['\u00bb', ['U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK', QUOTE]],
	['\u2039', ['U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK', QUOTE]],
	['\u203a', ['U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK', QUOTE]],
	['\u2010', ['U+2010 HYPHEN', HYPHEN]],
	['\u2011', ['U+2011 NON-BREAKING HYPHEN', HYPHEN]],
	['\u2012', ['U+2012 FIGURE DASH', HYPHEN]],
	['\u2013', ['U+2013 EN DASH', HYPHEN]],
	['\u2212', ['U+2212 MINUS SIGN', HYPHEN]],
	['\u00a0', ['U+00A0 NO-BREAK SPACE', SPACE]],
	['\u2007', ['U+2007 FIGURE SPACE', SPACE]],
	['\u2009', ['U+2009 THIN SPACE', SPACE]],
	['\u202f', ['U+202F NARROW NO-BREAK SPACE', SPACE]],
	['\u205f', ['U+205F MEDIUM MATHEMATICAL SPACE', SPACE]],
	['\u3000', ['U+3000 IDEOGRAPHIC SPACE', SPACE]],
	['\u200b', ['U+200B ZERO WIDTH SPACE', NOTHING]],
	['\u200c', ['U+200C ZERO WIDTH NON-JOINER', NOTHING]],
	['\u200d', ['U+200D ZERO WIDTH JOINER', NOTHING]],
	['\u2060', ['U+2060 WORD JOINER', NOTHING]],
	['\ufeff', ['U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM)', NOTHING]],
])

const CHAR_CLASS = `[${[...CONFUSABLES.keys()].join('')}]`

export const noConfusableChars = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow Unicode characters that look like ASCII but are not (curly quotes, non-em dashes, non-breaking and zero-width spaces)',
		},
		messages: {
			noConfusableChars:
				'{{name}} looks like ASCII but is not: it breaks string equality invisibly. Use {{fix}}.',
		},
		schema: [],
	},
	create(context) {
		return {
			Program(node) {
				reportSourceMatches(
					context,
					new RegExp(CHAR_CLASS, 'g'),
					([char]) => {
						const [name, fix] = CONFUSABLES.get(char)

						return {
							node,
							messageId: 'noConfusableChars',
							data: { name, fix },
						}
					},
				)
			},
		}
	},
}
