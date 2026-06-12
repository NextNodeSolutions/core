import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'oxlint'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginPath = resolve(__dirname, 'plugins', 'nextnode.js')

export default defineConfig({
	jsPlugins: [pluginPath],
	categories: {
		correctness: 'error',
		suspicious: 'warn',
		perf: 'warn',
	},
	plugins: ['typescript', 'react', 'unicorn', 'import', 'promise'],
	rules: {
		'eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
		'eslint/prefer-const': 'error',
		'eslint/no-var': 'error',
		'eslint/no-debugger': 'error',
		'eslint/no-console': 'warn',
		'eslint/eqeqeq': 'error',
		'eslint/prefer-template': 'error',
		'eslint/arrow-body-style': 'error',
		'eslint/complexity': ['error', { max: 15 }],
		'eslint/no-else-return': 'error',
		'eslint/no-lonely-if': 'error',
		'eslint/no-negated-condition': 'error',
		'eslint/max-depth': ['error', { max: 2 }],
		'eslint/max-nested-callbacks': ['error', { max: 3 }],
		'eslint/max-lines-per-function': [
			'error',
			{ max: 50, skipBlankLines: true, skipComments: true },
		],
		'eslint/max-lines': [
			'error',
			{ max: 250, skipBlankLines: true, skipComments: true },
		],
		'eslint/no-param-reassign': ['error', { props: true }],
		'eslint/no-empty': 'error',
		'eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
		'eslint/no-eval': 'error',
		'eslint/prefer-rest-params': 'error',
		'eslint/prefer-destructuring': 'warn',
		'eslint/no-await-in-loop': 'warn',
		'eslint/guard-for-in': 'error',
		'eslint/preserve-caught-error': 'error',
		'eslint/max-params': ['error', { max: 4 }],
		'eslint/no-underscore-dangle': [
			'warn',
			{ allow: ['__dirname', '__filename'] },
		],
		// warn, not error: the rule also flags the sanctioned `task().catch(report)`
		// detach idiom; hard fire-and-forget ban is typescript/no-floating-promises
		'promise/prefer-await-to-then': 'warn',
		'unicorn/no-array-sort': 'error',
		'unicorn/prefer-structured-clone': 'error',
		'unicorn/prefer-array-some': 'error',
		'import/no-default-export': 'error',
		// god-module smell (ARCH 1): a module importing the world does too much
		'import/max-dependencies': ['warn', { max: 20 }],
		'eslint/no-magic-numbers': [
			'error',
			{
				ignore: [0, 1, -1],
				ignoreEnums: true,
				ignoreReadonlyClassProperties: true,
			},
		],
		'typescript/no-explicit-any': 'error',
		'typescript/ban-ts-comment': 'error',
		'typescript/no-non-null-assertion': 'warn',
		'typescript/no-inferrable-types': 'error',
		// Type-aware rules: active only with `oxlint --type-aware`
		// (requires the optional oxlint-tsgolint peer dependency)
		'typescript/no-floating-promises': 'error',
		'typescript/no-misused-promises': 'error',
		'typescript/prefer-nullish-coalescing': 'error',
		'typescript/switch-exhaustiveness-check': 'error',
		'typescript/no-for-in-array': 'error',
		'typescript/prefer-optional-chain': 'error',
		'typescript/consistent-type-imports': [
			'error',
			{ prefer: 'type-imports', fixStyle: 'separate-type-imports' },
		],
		'typescript/no-dynamic-delete': 'error',
		'typescript/explicit-function-return-type': [
			'error',
			{
				allowExpressions: true,
				allowTypedFunctionExpressions: true,
				allowHigherOrderFunctions: true,
				allowDirectConstAssertionInArrowFunctions: true,
			},
		],
		'react/exhaustive-deps': 'warn',
		'react/rules-of-hooks': 'error',
		'react/no-array-index-key': 'error',
		'react/react-in-jsx-scope': 'off',
		// SRP proxies: one component per file, shallow JSX trees
		'react/no-multi-comp': 'warn',
		'react/jsx-max-depth': ['error', { max: 8 }],
		'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
		'nextnode/no-type-assertion': 'error',
		'nextnode/no-enum': 'error',
		'nextnode/no-boolean-params': 'error',
		'nextnode/boolean-naming': 'error',
		'nextnode/no-generic-names': 'warn',
		'nextnode/no-em-dash': 'error',
		'nextnode/no-use-effect': 'warn',
		'nextnode/max-props': 'warn',
		'nextnode/component-filename-match': 'error',
		'nextnode/no-grab-bag-files': 'error',
	},
	overrides: [
		{
			files: [
				'**/*.config.*',
				'**/*.test.*',
				'**/*.spec.*',
				'**/__tests__/**',
			],
			rules: {
				'eslint/no-console': 'off',
				'typescript/no-explicit-any': 'warn',
				'eslint/no-magic-numbers': 'off',
				'eslint/max-lines': 'off',
				'eslint/max-lines-per-function': 'off',
				// describe > it > callback IS the vitest DSL
				'eslint/max-nested-callbacks': 'off',
				'eslint/no-empty-function': 'off',
				'typescript/no-non-null-assertion': 'off',
			},
		},
		{
			// Framework entry points that require a default export
			files: [
				'**/*.config.*',
				'**/.*rc.*',
				'**/app/**/page.tsx',
				'**/app/**/layout.tsx',
				'**/app/**/template.tsx',
				'**/app/**/loading.tsx',
				'**/app/**/error.tsx',
				'**/app/**/not-found.tsx',
				'**/app/**/default.tsx',
				'**/pages/**',
				'**/middleware.ts',
				'**/*.stories.*',
			],
			rules: {
				'import/no-default-export': 'off',
			},
		},
		{
			files: ['**/*.astro'],
			rules: {
				'import/no-unassigned-import': 'off',
				'typescript/explicit-function-return-type': 'off',
			},
		},
		{
			files: ['**/tsconfig*.json'],
			rules: {},
		},
	],
	env: {
		browser: true,
		es2024: true,
		node: true,
	},
	globals: {
		React: 'readonly',
		JSX: 'readonly',
		NodeJS: 'readonly',
	},
})
