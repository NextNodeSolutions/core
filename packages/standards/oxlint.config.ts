import { defineConfig } from 'oxlint'

import standardsConfig from './src/oxlint/base.js'

export default defineConfig({
	extends: [standardsConfig],
	overrides: [
		{
			// every module this package ships IS a config consumed via
			// default export (vitest, tsdown, commitlint, oxlint base...)
			files: ['src/**'],
			rules: {
				'import/no-default-export': 'off',
			},
		},
	],
})
