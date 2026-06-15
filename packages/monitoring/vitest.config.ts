/// <reference types="@nextnode-solutions/standards/vitest/vite-plugin" />
import astroConfig from '@nextnode-solutions/standards/vitest/astro'
import { defineConfig, mergeConfig } from 'vitest/config'

import type { UserConfig } from 'vitest/config'

// `@nextnode-solutions/standards/vitest/astro` is built with Astro's
// `getViteConfig`, so at runtime it is an async config callback `(env) =>
// Promise<UserConfig>` (its `.d.ts` declares the resolved object shape). We
// resolve it, then layer the React-island test needs on top:
//   - environmentMatchGlobs: route `**/*.test.tsx` (React island tests) to
//     jsdom (matching `@nextnode-solutions/standards/vitest/frontend`
//     semantics) while every other test stays on the node environment.
//   - setupFiles: register @testing-library/react auto-cleanup.
// This keeps the Astro vite plugin pipeline and the 270 `.test.ts` domain /
// adapter tests (environment: 'node') exactly as the shared config defines them.
const islandOverrides = defineConfig({
	test: {
		environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
		setupFiles: ['./vitest.setup.tsx'],
	},
})

export default defineConfig(async configEnv => {
	const resolveAstroConfig: (env: typeof configEnv) => Promise<UserConfig> =
		typeof astroConfig === 'function'
			? astroConfig
			: () => Promise.resolve(astroConfig)

	const base = await resolveAstroConfig(configEnv)

	return mergeConfig(base, islandOverrides)
})
