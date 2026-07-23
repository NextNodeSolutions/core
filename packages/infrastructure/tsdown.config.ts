import baseConfig from '@nextnode-solutions/standards/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
	...baseConfig,
	entry: ['src/index.ts', 'src/lib/worker-types.ts'],
	dts: false,
})
