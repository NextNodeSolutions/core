import { describe, expect, it } from 'vitest'

import { deriveWorkerAssetsDirectory } from './assets-directory.ts'

describe('deriveWorkerAssetsDirectory', () => {
	it('recovers the assets directory from a _worker.js entry', () => {
		expect(deriveWorkerAssetsDirectory('dist/_worker.js/index.js')).toBe(
			'dist',
		)
	})

	it('recovers a nested assets directory', () => {
		expect(
			deriveWorkerAssetsDirectory('apps/web/dist/_worker.js/index.js'),
		).toBe('apps/web/dist')
	})

	it('returns undefined for an entry that is not a static-assets bundle', () => {
		expect(deriveWorkerAssetsDirectory('src/index.ts')).toBeUndefined()
	})

	it('returns undefined when the marker starts the entry (no assets dir)', () => {
		expect(
			deriveWorkerAssetsDirectory('/_worker.js/index.js'),
		).toBeUndefined()
	})
})
