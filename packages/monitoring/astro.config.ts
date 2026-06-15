import { defineConfig } from 'astro/config'

import node from '@astrojs/node'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

import { envSchema } from './src/config/env.schema.ts'

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	// React is opt-in per the astro-skill RULE 3: a NARROW integration scoped to
	// island files only. React islands are `.tsx` living under `src/islands/`
	// (or any co-located `**/islands/` dir); everything else stays plain Astro.
	integrations: [react({ include: ['**/islands/**'] })],
	server: {
		host: '0.0.0.0',
		port: Number(process.env.PORT ?? 4321),
	},
	site: process.env.SITE_URL,
	env: { schema: envSchema },
	// `noExternal: true` inlines every SSR dep into dist/server/entry.mjs so
	// the runtime image needs no node_modules. Strict ESM stack - no CommonJS
	// interop pitfalls. Skipped under vitest: `getViteConfig` reuses this file
	// and vite-node crashes on `noExternal: true`.
	vite: {
		plugins: [tailwindcss()],
		ssr: process.env.VITEST ? undefined : { noExternal: true },
	},
})
