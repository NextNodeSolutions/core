import baseConfig from '@nextnode-solutions/standards/vitest/backend'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			// Scaffold has no tests yet; do not fail the gate until Step 3 lands.
			// Remove this override once real tests exist under src/.
			passWithNoTests: true,
		},
	}),
)
