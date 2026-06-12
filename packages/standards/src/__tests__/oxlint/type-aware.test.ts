import { registerRuleSuite } from './rule-suite'
import { TYPE_AWARE_CASES } from './type-aware.fixtures'

registerRuleSuite(TYPE_AWARE_CASES, { typeAware: true })
