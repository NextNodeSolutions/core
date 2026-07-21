import { describe, expect, it } from 'vitest'

import {
	computeWorkersBuildDirectory,
	deriveWorkerAssetsDirectory,
} from './assets-directory.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

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

describe('computeWorkersBuildDirectory', () => {
	it('returns the assets directory of the primary routed service', () => {
		expect(
			computeWorkersBuildDirectory({
				web: worker({ url: 'example.com' }),
				api: worker({ url: 'api.example.com', entry: 'src/index.ts' }),
			}),
		).toBe('dist')
	})

	it('is empty when the primary routed service ships no assets', () => {
		expect(
			computeWorkersBuildDirectory({
				api: worker({ url: 'api.example.com', entry: 'src/index.ts' }),
			}),
		).toBe('')
	})

	it('is empty when no service is routed', () => {
		expect(computeWorkersBuildDirectory({ queue: worker() })).toBe('')
	})
})
