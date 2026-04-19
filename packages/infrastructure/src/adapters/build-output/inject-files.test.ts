import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { injectFiles } from './inject-files.ts'

let buildDir: string

beforeEach(() => {
	buildDir = mkdtempSync(join(tmpdir(), 'inject-files-'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(buildDir, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

describe('injectFiles', () => {
	it('writes each file into the build directory', () => {
		injectFiles(buildDir, [
			{ filename: 'robots.txt', content: 'User-agent: *\nDisallow: /\n' },
			{ filename: '_headers', content: '/*\n  X-Robots-Tag: noindex\n' },
		])

		expect(readFileSync(join(buildDir, 'robots.txt'), 'utf-8')).toBe(
			'User-agent: *\nDisallow: /\n',
		)
		expect(readFileSync(join(buildDir, '_headers'), 'utf-8')).toBe(
			'/*\n  X-Robots-Tag: noindex\n',
		)
	})

	it.each(['../escape.txt', '../../etc/passwd', 'sub/../../escape'])(
		'rejects filenames that resolve outside the build directory: %s',
		filename => {
			expect(() =>
				injectFiles(buildDir, [{ filename, content: 'x' }]),
			).toThrow(/resolves outside build directory/)
		},
	)

	it('rejects absolute filenames', () => {
		expect(() =>
			injectFiles(buildDir, [{ filename: '/etc/passwd', content: 'x' }]),
		).toThrow(/filename must be relative/)
	})

	it('rejects empty filenames', () => {
		expect(() =>
			injectFiles(buildDir, [{ filename: '', content: 'x' }]),
		).toThrow(/invalid filename/)
	})

	it('rejects filenames with null bytes', () => {
		expect(() =>
			injectFiles(buildDir, [{ filename: 'x\0y.txt', content: 'x' }]),
		).toThrow(/invalid filename/)
	})
})
