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
	it('writes both generated files into the app package root above the entry', () => {
		const appDir = makePackage('apps/web')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'dist/server/entry.mjs'),
			types: 'declare const x: 1\n',
			devVarsExample: 'SITE_URL=""\n',
		})

		expect(written).toEqual([
			join(appDir, 'worker-configuration.d.ts'),
			join(appDir, '.dev.vars.example'),
		])
		expect(
			readFileSync(join(appDir, 'worker-configuration.d.ts'), 'utf-8'),
		).toBe('declare const x: 1\n')
		expect(readFileSync(join(appDir, '.dev.vars.example'), 'utf-8')).toBe(
			'SITE_URL=""\n',
		)
	})

	it('leaves an existing .dev.vars untouched', () => {
		const appDir = makePackage('apps/web')
		const devVars = join(appDir, '.dev.vars')
		writeFileSync(devVars, 'SITE_URL="http://localhost:4321"\n')

		writeWorkerTypes({
			entryPath: join(appDir, 'dist/server/entry.mjs'),
			types: 'x',
			devVarsExample: 'SITE_URL=""\n',
		})

		expect(readFileSync(devVars, 'utf-8')).toBe(
			'SITE_URL="http://localhost:4321"\n',
		)
	})

	it('places the files even when the entry does not exist yet', () => {
		const appDir = makePackage('apps/api')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'src/index.ts'),
			types: 'x',
			devVarsExample: 'y',
		})

		expect(written).toContain(join(appDir, 'worker-configuration.d.ts'))
	})

	it('resolves to the nearest package root, not a higher one', () => {
		makePackage('.')
		const appDir = makePackage('apps/web')

		const written = writeWorkerTypes({
			entryPath: join(appDir, 'dist/server/entry.mjs'),
			types: 'x',
			devVarsExample: 'y',
		})

		expect(written).toEqual([
			join(appDir, 'worker-configuration.d.ts'),
			join(appDir, '.dev.vars.example'),
		])
	})

	it('throws when no package.json sits above the entry', () => {
		const orphan = join(root, 'no-manifest-here')
		mkdirSync(orphan, { recursive: true })

		expect(() =>
			writeWorkerTypes({
				entryPath: join(orphan, 'dist/entry.mjs'),
				types: 'x',
				devVarsExample: 'y',
			}),
		).toThrow(/found no package\.json/)
	})
})
