import standardsConfig from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standardsConfig],
	rules: {
		'eslint/no-console': 'off',
		'eslint/no-magic-numbers': 'off',
		'eslint/no-await-in-loop': 'off',
	},
	overrides: [
		{
			files: ['**/*.spec.ts', '**/*.test.ts'],
			rules: {
				'unicorn/consistent-function-scoping': 'off',
			},
		},
	],
})
