import baseConfig from '@nextnode-solutions/standards/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
	...baseConfig,
	entry: { index: 'src/index.ts' },
	dts: true,
	minify: true,
	sourcemap: false,
	outDir: 'dist',
})
