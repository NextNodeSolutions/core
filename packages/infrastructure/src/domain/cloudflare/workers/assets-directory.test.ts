import { describe, expect, it } from 'vitest'

import { deriveWorkerAssetsDirectory } from './assets-directory.ts'

describe('deriveWorkerAssetsDirectory', () => {
	describe('@astrojs/cloudflare v14 server/client convention', () => {
		it('derives the client directory from a server entry', () => {
			expect(deriveWorkerAssetsDirectory('dist/server/entry.mjs')).toBe(
				'dist/client',
			)
		})

		it('derives a nested client directory', () => {
			expect(
				deriveWorkerAssetsDirectory('apps/web/dist/server/entry.mjs'),
			).toBe('apps/web/dist/client')
		})

		it('ignores an intermediate server directory (entry deeper than server/)', () => {
			expect(
				deriveWorkerAssetsDirectory('dist/server/chunks/entry.mjs'),
			).toBeUndefined()
		})

		it('returns undefined when the server segment starts the entry', () => {
			expect(
				deriveWorkerAssetsDirectory('/server/entry.mjs'),
			).toBeUndefined()
		})
	})

	describe('historic _worker.js convention', () => {
		it('recovers the assets directory from a _worker.js entry', () => {
			expect(
				deriveWorkerAssetsDirectory('dist/_worker.js/index.js'),
			).toBe('dist')
		})

		it('recovers a nested assets directory', () => {
			expect(
				deriveWorkerAssetsDirectory(
					'apps/web/dist/_worker.js/index.js',
				),
			).toBe('apps/web/dist')
		})

		it('returns undefined when the marker starts the entry (no assets dir)', () => {
			expect(
				deriveWorkerAssetsDirectory('/_worker.js/index.js'),
			).toBeUndefined()
		})
	})

	it('returns undefined for an entry that is not a static-assets bundle', () => {
		expect(deriveWorkerAssetsDirectory('src/index.ts')).toBeUndefined()
	})
})
