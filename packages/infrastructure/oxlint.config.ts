import standardsConfig from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standardsConfig],
	overrides: [
		{
			// The gateway Worker core deploys in front of a container: the
			// Workers runtime calls its module's default export, and its
			// `console` output is what Workers observability records.
			files: ['runtime/container-gateway/worker.ts'],
			rules: {
				'import/no-default-export': 'off',
				'eslint/no-console': 'off',
			},
		},
	],
})
