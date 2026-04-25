import { resolve } from 'node:path'

import baseConfig from '@nextnode-solutions/standards/vitest/backend'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': resolve(__dirname, './src'),
			},
		},
	}),
)
