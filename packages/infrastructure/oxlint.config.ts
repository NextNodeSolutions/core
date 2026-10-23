import standardsConfig from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standardsConfig],
	overrides: [
		{
			// The gateway Worker core deploys in front of a container: the
			// Workers runtime calls its module's default export.
			files: ['runtime/container-gateway/worker.ts'],
			rules: {
				'import/no-default-export': 'off',
			},
		},
		{
			// The gateway's `console` output is what Workers observability
			// records.
			files: [
				'runtime/container-gateway/worker.ts',
				'runtime/container-gateway/service-container.ts',
			],
			rules: {
				'eslint/no-console': 'off',
			},
		},
	],
})
