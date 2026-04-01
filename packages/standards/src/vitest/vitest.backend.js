import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		// Environment Configuration
		globals: true,
		environment: 'node',
		env: {
			NODE_ENV: 'test',
		},

		// Mock Cleanup Configuration
		restoreMocks: true,
		clearMocks: true,
		unstubGlobals: true,
		mockReset: false,

		// Coverage Configuration
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/**',
				'dist/**',
				'**/*.d.ts',
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/*.config.ts',
				'**/types.ts',
			],
		},
	},
})
