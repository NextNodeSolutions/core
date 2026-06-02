import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeBakeFile } from './bake-file.ts'

let workspace: string

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), 'bake-file-'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(workspace, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

describe('writeBakeFile', () => {
	it('writes the bake definition content verbatim to the given path', () => {
		const path = join(workspace, 'docker-bake.json')
		const content = '{\n\t"group": { "default": { "targets": ["app"] } }\n}'

		writeBakeFile(path, content)

		expect(readFileSync(path, 'utf-8')).toBe(content)
	})

	it('propagates the write error instead of swallowing it when the directory is missing', () => {
		const path = join(workspace, 'does-not-exist', 'docker-bake.json')

		expect(() => writeBakeFile(path, '{}')).toThrow('ENOENT')
	})
})
