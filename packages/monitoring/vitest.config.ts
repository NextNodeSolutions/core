/// <reference types="@nextnode-solutions/standards/vitest/vite-plugin" />
import astroConfig from '@nextnode-solutions/standards/vitest/astro'
import { defineConfig } from 'vitest/config'

import type { UserConfig } from 'vitest/config'

// Two test surfaces with incompatible needs, split into vitest projects:
//   - `.test.ts`  -> the Astro getViteConfig pipeline (node env). The domain /
//     adapter / API-route tests rely on the Astro vite plugins.
//   - `.test.tsx` -> React island tests (jsdom). The Astro pipeline is
//     SSR-flavoured and evaluates `react` a SECOND time for source files, so a
//     direct `import { useState } from 'react'` gets a copy whose hook
//     dispatcher is null at render (jotai-only components dodge it; ours crash).
//     This project drops the Astro plugin, loads React's dev builds, and shares
//     one React instance across source, jotai and @testing-library/react.
const SRC_DIR = new URL('./src/', import.meta.url).pathname

const islandProject = defineConfig({
	// Automatic JSX runtime so `.tsx` needs no `import React`, matching the app's
	// modern-runtime setup (react-in-jsx-scope is off in the lint config).
	esbuild: { jsx: 'automatic', jsxDev: true },
	optimizeDeps: {
		// Don't pre-bundle React/jotai: a pre-bundled copy links its OWN react
		// whose scheduler can't see promises resolved elsewhere, which breaks
		// Suspense recovery (the fallback never swaps to content).
		exclude: [
			'react',
			'react-dom',
			'react-dom/client',
			'jotai',
			'jotai/utils',
		],
	},
	resolve: {
		alias: [{ find: /^@\//, replacement: SRC_DIR }],
		// Load React's DEVELOPMENT builds: with NODE_ENV=test neither the
		// `development` nor `production` export condition matches by default, and
		// the resulting build's Suspense retry does not fire under jsdom. Adding
		// the condition selects react/react-dom dev, which recovers Suspense.
		conditions: ['development', 'browser'],
		dedupe: ['react', 'react-dom'],
	},
	test: {
		name: 'islands',
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.test.tsx'],
		setupFiles: ['./vitest.setup.tsx'],
		server: {
			deps: {
				// Inline jotai so it shares the SAME react instance as react-dom.
				// A pre-bundled jotai links its own react copy, which breaks
				// async-atom Suspense recovery (the resolved promise never
				// schedules a re-render).
				inline: [/jotai/],
			},
		},
	},
})

export default defineConfig(async configEnv => {
	const resolveAstroConfig: (env: typeof configEnv) => Promise<UserConfig> =
		typeof astroConfig === 'function'
			? astroConfig
			: () => Promise.resolve(astroConfig)

	const base = await resolveAstroConfig(configEnv)

	// The Astro-driven project keeps the shared config verbatim but only owns
	// the `.test.ts` suite; `.test.tsx` is handed to the island project above.
	const astroProject: UserConfig = {
		...base,
		test: {
			...base.test,
			name: 'astro',
			include: ['src/**/*.test.ts'],
		},
	}

	return defineConfig({
		test: {
			projects: [astroProject, islandProject],
		},
	})
})
