import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		// Environment Configuration
		environment: 'jsdom',
		globals: true,

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
