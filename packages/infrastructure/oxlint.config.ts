import standardsConfig from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standardsConfig],
	rules: {
		'eslint/no-restricted-globals': [
			'error',
			{
				name: 'fetch',
				message:
					'Call fetchBounded from the HTTP adapter, which gives every request a time limit.',
			},
		],
	},
})
