import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePackageDir } from './package-dir.ts'

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'package-dir-'))
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
})

function makePackage(relativeDir: string): string {
	const dir = join(root, relativeDir)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'package.json'), '{}')
	return dir
}

describe('resolvePackageDir', () => {
	it('returns the nearest ancestor holding a package.json', () => {
		makePackage('.')
		const appDir = makePackage('apps/api')

		expect(resolvePackageDir(join(appDir, 'src/index.ts'))).toBe(appDir)
	})

	it('throws when no package.json sits above the entry', () => {
		const orphan = join(root, 'no-manifest-here')
		mkdirSync(orphan, { recursive: true })

		expect(() => resolvePackageDir(join(orphan, 'dist/entry.mjs'))).toThrow(
			/found no package\.json/,
		)
	})
})
