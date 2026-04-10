/// <reference types="@nextnode-solutions/standards/vitest/vite-plugin" />
import { getViteConfig } from 'astro/config'

export default getViteConfig({
	test: {
		// Environment Configuration
		environment: 'node',
		globals: true,

		// Test Discovery
		exclude: ['node_modules/**', 'dist/**', '.infra/**'],

		// Mock Cleanup Configuration
		restoreMocks: true,
		clearMocks: true,
		unstubGlobals: true,
		mockReset: false,

		// Coverage Configuration
		coverage: {
			provider: 'v8',
			reporter: ['json', 'html', 'text'],
			enabled: true,
			exclude: [
				'**/*.test.ts',
				'**/*.test.tsx',
				'**/*.spec.ts',
				'**/*.spec.tsx',
				'**/node_modules/**',
				'**/dist/**',
				'**/.astro/**',
				'**/coverage/**',
				'**/tests/**',
				'**/config/**',
				'**/types/**',
			],
		},
	},
})
