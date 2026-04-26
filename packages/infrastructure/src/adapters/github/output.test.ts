import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeMaskedOutput, writeOutput } from './output.ts'

describe('writeMaskedOutput', () => {
	let outputFile: string
	let stdoutSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		stdoutSpy = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true)
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('emits ::add-mask:: on stdout before writing the output', () => {
		writeMaskedOutput('r2_access_key_id', 'secret-value')

		const writes = stdoutSpy.mock.calls.map(call => String(call[0]))
		expect(writes).toContain('::add-mask::secret-value\n')

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toBe('r2_access_key_id=secret-value\n')
	})

	it('still writes to GITHUB_OUTPUT in the standard key=value format', () => {
		writeMaskedOutput('foo', 'bar')

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toBe('foo=bar\n')
	})

	it('throws when GITHUB_OUTPUT is not set (after emitting the mask)', () => {
		vi.stubEnv('GITHUB_OUTPUT', undefined)

		expect(() => writeMaskedOutput('k', 'v')).toThrow(
			'GITHUB_OUTPUT env var',
		)
	})
})

describe('writeOutput', () => {
	let outputFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
	})

	it('appends key=value to GITHUB_OUTPUT', () => {
		writeOutput('a', '1')
		writeOutput('b', '2')

		expect(readFileSync(outputFile, 'utf-8')).toBe('a=1\nb=2\n')
	})

	it('throws when GITHUB_OUTPUT is not set', () => {
		vi.stubEnv('GITHUB_OUTPUT', undefined)

		expect(() => writeOutput('a', '1')).toThrow('GITHUB_OUTPUT env var')
	})
})
