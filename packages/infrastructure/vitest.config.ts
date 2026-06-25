import { resolve } from 'node:path'

import baseConfig from '@nextnode-solutions/standards/vitest/backend'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			setupFiles: ['./vitest.setup.ts'],
			// Restore vi.stubEnv() between tests so the hermetic baseline in
			// vitest.setup.ts is self-enforcing - a test that stubs an env var
			// can no longer leak it into siblings. (Base config only sets
			// unstubGlobals.)
			unstubEnvs: true,
		},
		resolve: {
			alias: {
				'#': resolve(__dirname, './src'),
			},
		},
	}),
)
