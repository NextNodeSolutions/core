/**
 * NextNode custom oxlint plugin - mechanized rules from the coding,
 * typescript and react skills that no native oxlint rule covers.
 */
import { booleanNaming } from './rules/boolean-naming.js'
import { componentFilenameMatch } from './rules/component-filename-match.js'
import { maxProps } from './rules/max-props.js'
import { noBooleanParams } from './rules/no-boolean-params.js'
import { noEmDash } from './rules/no-em-dash.js'
import { noEnum } from './rules/no-enum.js'
import { noGenericNames } from './rules/no-generic-names.js'
import { noGrabBagFiles } from './rules/no-grab-bag-files.js'
import { noTypeAssertion } from './rules/no-type-assertion.js'
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
		'no-use-effect': noUseEffect,
		'max-props': maxProps,
		'component-filename-match': componentFilenameMatch,
		'no-grab-bag-files': noGrabBagFiles,
	},
}

export default plugin
