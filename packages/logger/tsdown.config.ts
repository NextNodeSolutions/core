import baseConfig from '@nextnode-solutions/standards/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
	...baseConfig,
	entry: {
		logger: 'src/logger.ts',
		testing: 'src/testing/test-utils.ts',
		'transports/http': 'src/transports/http.ts',
	},
	dts: true,
})
