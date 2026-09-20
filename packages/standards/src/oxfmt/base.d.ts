import type { OxfmtConfig } from 'oxfmt'

// The preset always ships `ignorePatterns` and consumers spread it before
// layering their own patterns, so it is part of the contract, not optional.
declare const config: OxfmtConfig & { ignorePatterns: string[] }
export default config
