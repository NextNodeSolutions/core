import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeWorkerTypes } from './write-worker-types.ts'

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'write-worker-types-'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

function makePackage(relativeDir: string): string {
	const dir = join(root, relativeDir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'package.json'), '{}')
	return dir
}

describe('writeWorkerTypes', () => {
	it('writes the types into the app package root above the entry', () => {
		const appDir = makePackage('apps/web')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'dist/server/entry.mjs'),
			content: 'declare const x: 1\n',
		})

		expect(written).toBe(join(appDir, 'worker-configuration.d.ts'))
		expect(readFileSync(written, 'utf-8')).toBe('declare const x: 1\n')
	})

	it('places the file even when the entry does not exist yet', () => {
		const appDir = makePackage('apps/api')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'src/index.ts'),
			content: 'x',
		})

		expect(written).toBe(join(appDir, 'worker-configuration.d.ts'))
	})

	it('resolves to the nearest package root, not a higher one', () => {
		makePackage('.')
		const appDir = makePackage('apps/web')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'dist/server/entry.mjs'),
			content: 'x',
		})

		expect(written).toBe(join(appDir, 'worker-configuration.d.ts'))
	})

	it('throws when no package.json sits above the entry', () => {
		const orphan = join(root, 'no-manifest-here')
		mkdirSync(orphan, { recursive: true })

		expect(() =>
			writeWorkerTypes({
				entryPath: join(orphan, 'dist/entry.mjs'),
				content: 'x',
			}),
		).toThrow(/found no package\.json/)
	})
})
