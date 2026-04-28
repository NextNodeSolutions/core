import node from '@astrojs/node'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

import { envSchema } from './src/config/env.schema.ts'

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	server: {
		host: '0.0.0.0',
		port: Number(process.env.PORT ?? 4321),
	},
	site: process.env.SITE_URL,
	env: { schema: envSchema },
	// `noExternal: true` inlines every SSR dep into dist/server/entry.mjs so
	// the runtime image needs no node_modules. Strict ESM stack — no CommonJS
	// interop pitfalls. Skipped under vitest: `getViteConfig` reuses this file
	// and vite-node crashes on `noExternal: true`.
	vite: {
		plugins: [tailwindcss()],
		ssr: process.env.VITEST ? undefined : { noExternal: true },
	},
})
