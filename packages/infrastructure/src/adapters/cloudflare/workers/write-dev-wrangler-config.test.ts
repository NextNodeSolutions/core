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

import { writeDevWranglerConfig } from './write-dev-wrangler-config.ts'

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'write-dev-wrangler-'))
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

describe('writeDevWranglerConfig', () => {
	it('writes wrangler.jsonc into the app package root above the entry', () => {
		const appDir = makePackage('apps/api')

		const written = writeDevWranglerConfig({
			entryPath: join(appDir, 'src/index.ts'),
			content: '// x\n{}\n',
		})

		expect(written).toBe(join(appDir, 'wrangler.jsonc'))
		expect(readFileSync(written, 'utf-8')).toBe('// x\n{}\n')
	})

	it('places the file even when the entry does not exist yet', () => {
		const appDir = makePackage('apps/api')

		const written = writeDevWranglerConfig({
			entryPath: join(appDir, 'src/index.ts'),
			content: 'x',
		})

		expect(written).toBe(join(appDir, 'wrangler.jsonc'))
	})
})
