/**
 * Bridge for Vitest's module augmentation of Vite's UserConfig.
 *
 * When pnpm isolates vite@6 (Astro) and vite@7 (Vitest), the augmentation
 * that adds `test` to Vite's `UserConfig` only reaches vite@7's types.
 * This declaration re-applies the augmentation so it works regardless of
 * which vite version is resolved.
 *
 * Usage — add a triple-slash directive at the top of your vite/vitest config:
 *   /// <reference types="@nextnode-solutions/standards/vitest/vite-plugin" />
 */

import type { InlineConfig } from 'vitest/node'

declare module 'vite' {
	interface UserConfig {
		test?: InlineConfig
	}
}
