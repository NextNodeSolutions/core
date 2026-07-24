/**
 * NextNode custom oxlint plugin - mechanized rules from the coding,
 * typescript and react skills that no native oxlint rule covers.
 */
import { booleanNaming } from './rules/boolean-naming.js'
import { componentFilenameMatch } from './rules/component-filename-match.js'
import { maxProps } from './rules/max-props.js'
import { noBooleanParams } from './rules/no-boolean-params.js'
import { noConfusableChars } from './rules/no-confusable-chars.js'
import { noEmDash } from './rules/no-em-dash.js'
import { noEmptyObjectTernary } from './rules/no-empty-object-ternary.js'
import { noEnum } from './rules/no-enum.js'
import { noGenericNames } from './rules/no-generic-names.js'
import { noGrabBagFiles } from './rules/no-grab-bag-files.js'
import { noLeadingSemicolon } from './rules/no-leading-semicolon.js'
import { noLengthZeroComparison } from './rules/no-length-zero-comparison.js'
import { noNullishTernaryReturn } from './rules/no-nullish-ternary-return.js'
import { noSentinelConsequent } from './rules/no-sentinel-consequent.js'
import { noSingleUsePassthrough } from './rules/no-single-use-passthrough.js'
import { noTernarySpread } from './rules/no-ternary-spread.js'
import { noTypeAssertion } from './rules/no-type-assertion.js'
import { noUndefinedComparison } from './rules/no-undefined-comparison.js'
import { noUseEffect } from './rules/no-use-effect.js'

const plugin = {
	meta: {
		name: 'nextnode',
	},
	rules: {
		'no-type-assertion': noTypeAssertion,
		'no-enum': noEnum,
		'no-boolean-params': noBooleanParams,
		'boolean-naming': booleanNaming,
		'no-generic-names': noGenericNames,
		'no-em-dash': noEmDash,
		'no-confusable-chars': noConfusableChars,
		'no-use-effect': noUseEffect,
		'max-props': maxProps,
		'component-filename-match': componentFilenameMatch,
		'no-grab-bag-files': noGrabBagFiles,
		'no-leading-semicolon': noLeadingSemicolon,
		'no-length-zero-comparison': noLengthZeroComparison,
		'no-nullish-ternary-return': noNullishTernaryReturn,
		'no-empty-object-ternary': noEmptyObjectTernary,
		'no-sentinel-consequent': noSentinelConsequent,
		'no-single-use-passthrough': noSingleUsePassthrough,
		'no-undefined-comparison': noUndefinedComparison,
		'no-ternary-spread': noTernarySpread,
	},
}

export default plugin
